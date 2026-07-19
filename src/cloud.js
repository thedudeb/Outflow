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
