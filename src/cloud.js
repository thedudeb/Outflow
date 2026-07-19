const projectUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "",
).trim();

function validProjectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function jwtRole(value) {
  if (!value.includes(".")) return "";
  try {
    const payload = value.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof decoded.role === "string" ? decoded.role : "";
  } catch {
    return "";
  }
}

const secretKeyExposed = publishableKey.startsWith("sb_secret_") || jwtRole(publishableKey) === "service_role";
const hasPartialConfig = Boolean(projectUrl || publishableKey);

export const cloudConfigError = secretKeyExposed
  ? "A server-only Supabase secret was supplied to the browser. Use a publishable key instead."
  : hasPartialConfig && (!validProjectUrl(projectUrl) || !publishableKey)
    ? "Supabase cloud configuration is incomplete or invalid."
    : "";

export const cloudConfigured = Boolean(projectUrl && publishableKey && !cloudConfigError);

let cloudPromise;

export function getCloud() {
  if (!cloudConfigured) return Promise.resolve(null);
  if (!cloudPromise) {
    cloudPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient(projectUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
      global: {
        headers: { "X-Client-Info": "outflow-web" },
      },
    }));
  }
  return cloudPromise;
}

export async function requestAccountLink(email) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const redirect = new URL(window.location.href);
  redirect.hash = window.location.hash === "#app" || window.location.hash.startsWith("#app?") ? window.location.hash : "app";
  const { error } = await cloud.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.toString(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

export async function uploadGuestWorkspace(workspace) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.rpc("migrate_guest_workspace", { workspace_payload: workspace });
  if (error) throw error;
  return data;
}

export async function readProEntitlement(userId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud
    .from("entitlements")
    .select("status, provider, purchased_at")
    .eq("user_id", userId)
    .eq("product", "outflow_pro_lifetime")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function readProOffer() {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.functions.invoke("create-pro-checkout", { method: "GET" });
  if (error) throw error;
  const unitAmount = Number(data?.unitAmount);
  const currency = typeof data?.currency === "string" ? data.currency.toUpperCase() : "";
  if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("The Outflow Pro offer is unavailable.");
  }
  return {
    currency,
    name: typeof data?.name === "string" ? data.name.slice(0, 80) : "Outflow Pro",
    unitAmount,
  };
}

export async function createProCheckout(operationId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.functions.invoke("create-pro-checkout", {
    method: "POST",
    body: { operationId },
  });
  if (error) throw error;
  try {
    const url = new URL(data?.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new Error("Stripe did not return a valid hosted checkout URL.");
  }
}

export async function readCloudLedgerAccess(userId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");

  const { data: ledgers, error: ledgerError } = await cloud
    .from("ledgers")
    .select("id, name, kind, owner_id, revision, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (ledgerError) throw ledgerError;
  if (!ledgers?.length) return [];

  const ledgerIds = ledgers.map((ledger) => ledger.id);
  const { data: members, error: memberError } = await cloud
    .from("ledger_members")
    .select("ledger_id, user_id, role, joined_at")
    .in("ledger_id", ledgerIds)
    .order("joined_at", { ascending: true });
  if (memberError) throw memberError;

  const userIds = [...new Set((members || []).map((member) => member.user_id))];
  let profiles = [];
  if (userIds.length) {
    const { data, error } = await cloud
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    if (error) throw error;
    profiles = data || [];
  }

  const ownedLedgerIds = ledgers.filter((ledger) => ledger.owner_id === userId).map((ledger) => ledger.id);
  let invitations = [];
  if (ownedLedgerIds.length) {
    const { data, error } = await cloud
      .from("ledger_invitations")
      .select("id, ledger_id, email, role, invited_by, expires_at, accepted_at, created_at")
      .in("ledger_id", ownedLedgerIds)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    if (error) throw error;
    invitations = data || [];
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return ledgers.map((ledger) => ({
    id: ledger.id,
    name: ledger.name,
    kind: ledger.kind,
    ownerId: ledger.owner_id,
    revision: Number(ledger.revision || 0),
    createdAt: ledger.created_at,
    updatedAt: ledger.updated_at,
    currentRole: ledger.owner_id === userId
      ? "owner"
      : members?.find((member) => member.ledger_id === ledger.id && member.user_id === userId)?.role || "viewer",
    members: (members || [])
      .filter((member) => member.ledger_id === ledger.id)
      .map((member) => ({
        userId: member.user_id,
        role: member.role,
        joinedAt: member.joined_at,
        displayName: profileById.get(member.user_id)?.display_name || "",
      })),
    invitations: invitations
      .filter((invitation) => invitation.ledger_id === ledger.id)
      .map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at,
        createdAt: invitation.created_at,
      })),
  }));
}

function cloudMemberLabel(member, userId) {
  if (!member) return "Cloud member";
  if (member.userId === userId) return "You";
  return member.displayName || `Member ${member.userId.slice(0, 8)}`;
}

export async function readCloudLedgerSnapshot(ledgerId, userId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");

  const access = (await readCloudLedgerAccess(userId)).find((ledger) => ledger.id === ledgerId);
  if (!access) throw new Error("This cloud ledger is unavailable.");

  const { data: rows, error } = await cloud
    .from("subscriptions")
    .select("ledger_id, id, name, amount, currency, cycle, next_billing_date, category, tags, color, trial_end_date, reminder_lead_days, paused, revision, created_by, updated_by, source_created_by, source_updated_by, client_updated_at, created_at, updated_at")
    .eq("ledger_id", ledgerId)
    .order("next_billing_date", { ascending: true });
  if (error) throw error;

  const { data: canSync, error: syncError } = await cloud.rpc("can_sync_ledger", { target_ledger_id: ledgerId });
  if (syncError) throw syncError;
  const memberById = new Map(access.members.map((member) => [member.userId, member]));

  return {
    ledger: {
      id: access.id,
      name: access.name,
      kind: access.kind,
      storage: "cloud",
      ownerId: access.ownerId,
      currentRole: access.currentRole,
      revision: access.revision,
      canSync: canSync === true,
      createdAt: access.createdAt,
      updatedAt: access.updatedAt,
    },
    subscriptions: (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      currency: row.currency,
      cycle: row.cycle,
      nextBillingDate: row.next_billing_date,
      category: row.category,
      tags: row.tags || [],
      color: row.color,
      trialEndDate: row.trial_end_date || "",
      reminderLeadDays: row.reminder_lead_days || [],
      paused: row.paused === true,
      revision: Number(row.revision || 0),
      updatedAt: row.client_updated_at || row.updated_at,
      createdBy: row.created_by ? cloudMemberLabel(memberById.get(row.created_by), userId) : row.source_created_by,
      updatedBy: row.updated_by ? cloudMemberLabel(memberById.get(row.updated_by), userId) : row.source_updated_by,
    })),
  };
}

export async function replaceCloudLedgerSnapshot(ledgerId, expectedRevision, subscriptions, operationId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.rpc("replace_ledger_snapshot", {
    target_ledger_id: ledgerId,
    expected_revision: expectedRevision,
    client_operation_id: operationId,
    subscriptions_payload: subscriptions,
  });
  if (error) throw error;
  return data;
}

export async function renameCloudLedger(ledgerId, expectedRevision, name, operationId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.rpc("rename_cloud_ledger", {
    target_ledger_id: ledgerId,
    expected_revision: expectedRevision,
    client_operation_id: operationId,
    ledger_name: name,
  });
  if (error) throw error;
  return data;
}

export async function subscribeToCloudLedger(ledgerId, onChange) {
  const cloud = await getCloud();
  if (!cloud) return () => {};
  const channel = cloud
    .channel(`outflow-ledger-${ledgerId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "ledgers", filter: `id=eq.${ledgerId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `ledger_id=eq.${ledgerId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "ledger_members", filter: `ledger_id=eq.${ledgerId}` }, onChange)
    .subscribe();
  return () => {
    cloud.removeChannel(channel);
  };
}

export async function sendCloudLedgerInvitation({ ledgerId, email, role }) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.functions.invoke("send-ledger-invite", {
    method: "POST",
    body: { ledgerId, email, role },
  });
  if (error) throw error;
  return data;
}

export async function acceptCloudLedgerInvitation(token) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.rpc("accept_ledger_invitation", { invitation_token: token });
  if (error) throw error;
  return data;
}

export async function updateCloudLedgerMemberRole(ledgerId, userId, role) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { error } = await cloud
    .from("ledger_members")
    .update({ role })
    .eq("ledger_id", ledgerId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function removeCloudLedgerMember(ledgerId, userId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { error } = await cloud
    .from("ledger_members")
    .delete()
    .eq("ledger_id", ledgerId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function revokeCloudLedgerInvitation(invitationId) {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { error } = await cloud.from("ledger_invitations").delete().eq("id", invitationId);
  if (error) throw error;
}

export async function deleteCloudAccount() {
  const cloud = await getCloud();
  if (!cloud) throw new Error("Outflow cloud is not configured.");
  const { data, error } = await cloud.functions.invoke("delete-account", { method: "POST" });
  if (error) throw error;
  return data;
}
