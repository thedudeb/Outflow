import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "outflow:subscriptions";
const LEGACY_STORAGE_KEY = "drain:subscriptions";
const NOTIFIED_ALERTS_KEY = "outflow:notified-alerts";

const colorTags = [
  { label: "Amber", value: "#f59e0b" },
  { label: "Red", value: "#ef4444" },
  { label: "Cyan", value: "#22d3ee" },
  { label: "Lime", value: "#84cc16" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Steel", value: "#94a3b8" },
];

const cycles = [
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
];

const validCycles = new Set(cycles.map((cycle) => cycle.value));
const validColors = new Set(colorTags.map((tag) => tag.value));
const reminderOptions = [
  { label: "Off", value: -1 },
  { label: "Same day", value: 0 },
  { label: "1 day before", value: 1 },
  { label: "3 days before", value: 3 },
  { label: "7 days before", value: 7 },
  { label: "14 days before", value: 14 },
];
const validReminderDays = new Set(reminderOptions.map((option) => option.value));
const MAX_SUBSCRIPTIONS = 500;
const MAX_DATE_ADVANCES = 50000;
const MAX_TAGS = 10;

const seedSubscriptions = [
  {
    id: "netflix",
    name: "Netflix",
    amount: 15.49,
    cycle: "monthly",
    nextBillingDate: "2026-05-24",
    category: "Streaming",
    tags: ["personal", "video"],
    color: "#ef4444",
    trialEndDate: "",
    reminderDays: 7,
    paused: false,
  },
  {
    id: "spotify",
    name: "Spotify",
    amount: 10.99,
    cycle: "monthly",
    nextBillingDate: "2026-05-29",
    category: "Music",
    tags: ["personal", "audio"],
    color: "#84cc16",
    trialEndDate: "2026-07-26",
    reminderDays: 7,
    paused: false,
  },
  {
    id: "icloud",
    name: "iCloud+",
    amount: 2.99,
    cycle: "monthly",
    nextBillingDate: "2026-06-03",
    category: "Storage",
    tags: ["cloud"],
    color: "#22d3ee",
    trialEndDate: "",
    reminderDays: 7,
    paused: false,
  },
  {
    id: "github",
    name: "GitHub Copilot",
    amount: 10,
    cycle: "monthly",
    nextBillingDate: "2026-06-08",
    category: "Dev Tools",
    tags: ["work", "development"],
    color: "#94a3b8",
    trialEndDate: "",
    reminderDays: 7,
    paused: false,
  },
  {
    id: "notion",
    name: "Notion Plus",
    amount: 96,
    cycle: "yearly",
    nextBillingDate: "2026-08-17",
    category: "Productivity",
    tags: ["work"],
    color: "#f59e0b",
    trialEndDate: "",
    reminderDays: 7,
    paused: true,
  },
];

const blankForm = {
  name: "",
  amount: "",
  cycle: "monthly",
  nextBillingDate: toDateInput(new Date()),
  category: "",
  tags: "",
  color: colorTags[0].value,
  trialEndDate: "",
  reminderDays: 7,
  paused: false,
};

function toDateInput(date) {
  const shifted = new Date(date);
  shifted.setMinutes(shifted.getMinutes() - shifted.getTimezoneOffset());
  return shifted.toISOString().slice(0, 10);
}

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDate(value);
  return Number.isFinite(parsed.getTime()) && toDateInput(parsed) === value;
}

function sanitizeSubscription(value) {
  if (!value || typeof value !== "object") return null;

  const name = typeof value.name === "string" ? value.name.trim().slice(0, 100) : "";
  const amount = Number(value.amount);
  const category = typeof value.category === "string" ? value.category.trim().slice(0, 60) : "Unsorted";
  const rawTags = Array.isArray(value.tags)
    ? value.tags
    : typeof value.tags === "string"
      ? value.tags.split(",")
      : [];
  const tags = [...new Set(
    rawTags
      .filter((tag) => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase().slice(0, 24))
      .filter(Boolean),
  )].slice(0, MAX_TAGS);
  const trialEndDate = value.trialEndDate === "" || value.trialEndDate == null
    ? ""
    : isValidDate(value.trialEndDate)
      ? value.trialEndDate
      : "";
  const reminderDays = validReminderDays.has(Number(value.reminderDays)) ? Number(value.reminderDays) : 7;

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 1000000000 ||
    !validCycles.has(value.cycle) ||
    !isValidDate(value.nextBillingDate)
  ) {
    return null;
  }

  return {
    id: typeof value.id === "string" && value.id.length <= 100 ? value.id : crypto.randomUUID(),
    name,
    amount,
    cycle: value.cycle,
    nextBillingDate: value.nextBillingDate,
    category: category || "Unsorted",
    tags,
    color: validColors.has(value.color) ? value.color : colorTags[0].value,
    trialEndDate,
    reminderDays,
    paused: value.paused === true,
  };
}

function sanitizeSubscriptions(value) {
  if (!Array.isArray(value)) throw new TypeError("Stored subscriptions must be an array");
  return value.slice(0, MAX_SUBSCRIPTIONS).map(sanitizeSubscription).filter(Boolean);
}

function addCycle(date, cycle) {
  const next = new Date(date);
  if (cycle === "weekly") next.setDate(next.getDate() + 7);
  if (cycle === "monthly") next.setMonth(next.getMonth() + 1);
  if (cycle === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

function normalizeBillingDate(subscription, today = new Date()) {
  if (subscription.paused) return subscription;
  if (!validCycles.has(subscription.cycle) || !isValidDate(subscription.nextBillingDate)) return subscription;

  const startOfToday = parseDate(toDateInput(today));
  let nextDate = parseDate(subscription.nextBillingDate);
  let advances = 0;

  while (nextDate < startOfToday && advances < MAX_DATE_ADVANCES) {
    nextDate = addCycle(nextDate, subscription.cycle);
    advances += 1;
  }

  if (nextDate < startOfToday) return subscription;

  const normalizedDate = toDateInput(nextDate);
  return normalizedDate === subscription.nextBillingDate
    ? subscription
    : { ...subscription, nextBillingDate: normalizedDate };
}

function daysBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((parseDate(end) - parseDate(start)) / msPerDay);
}

function monthlyEquivalent(subscription) {
  const amount = Number(subscription.amount) || 0;
  if (subscription.cycle === "weekly") return (amount * 52) / 12;
  if (subscription.cycle === "yearly") return amount / 12;
  return amount;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function shortDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(parseDate(value));
}

function fullDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(parseDate(value));
}

function buildSchedule(subscriptions, startValue, endValue) {
  if (!isValidDate(startValue) || !isValidDate(endValue)) return [];

  const startDate = parseDate(startValue);
  const endDate = parseDate(endValue);
  if (startDate > endDate) return [];

  return subscriptions
    .filter((subscription) => !subscription.paused)
    .flatMap((subscription) => {
      if (!validCycles.has(subscription.cycle) || !isValidDate(subscription.nextBillingDate)) return [];

      const events = [];
      let eventDate = parseDate(subscription.nextBillingDate);
      let eventCount = 0;

      while (eventDate < startDate && eventCount < MAX_DATE_ADVANCES) {
        eventDate = addCycle(eventDate, subscription.cycle);
        eventCount += 1;
      }

      while (eventDate <= endDate && eventCount < MAX_DATE_ADVANCES) {
        const date = toDateInput(eventDate);
        events.push({
          ...subscription,
          eventId: `${subscription.id}-${date}`,
          date,
        });
        eventDate = addCycle(eventDate, subscription.cycle);
        eventCount += 1;
      }

      return events;
    })
    .sort((a, b) => parseDate(a.date) - parseDate(b.date) || a.name.localeCompare(b.name));
}

function buildTimeline(subscriptions, days = 30) {
  const today = toDateInput(new Date());
  const endDate = parseDate(today);
  endDate.setDate(endDate.getDate() + days);

  return buildSchedule(subscriptions, today, toDateInput(endDate)).map((event) => ({
    ...event,
    daysOut: daysBetween(today, event.date),
  }));
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function monthBounds(date) {
  return {
    start: toDateInput(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toDateInput(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

function calendarDays(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function weeklyForecast(events, days) {
  const today = parseDate(toDateInput(new Date()));
  const bucketCount = Math.ceil((days + 1) / 7);

  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const bucketEvents = events.filter((event) => Math.floor(event.daysOut / 7) === index);
    return {
      id: `${toDateInput(start)}-${toDateInput(end)}`,
      label: `${shortDate(toDateInput(start))}-${shortDate(toDateInput(end))}`,
      total: bucketEvents.reduce((sum, event) => sum + Number(event.amount), 0),
      count: bucketEvents.length,
    };
  });
}

function buildAlerts(subscriptions, today = toDateInput(new Date())) {
  return subscriptions
    .filter((subscription) => !subscription.paused && subscription.reminderDays >= 0)
    .flatMap((subscription) => {
      const alerts = [];
      const chargeDays = daysBetween(today, subscription.nextBillingDate);

      if (chargeDays >= 0 && chargeDays <= subscription.reminderDays) {
        alerts.push({
          id: `charge-${subscription.id}-${subscription.nextBillingDate}`,
          type: "charge",
          name: subscription.name,
          date: subscription.nextBillingDate,
          daysOut: chargeDays,
          amount: subscription.amount,
          color: subscription.color,
        });
      }

      if (subscription.trialEndDate) {
        const trialDays = daysBetween(today, subscription.trialEndDate);
        if (trialDays >= 0 && trialDays <= subscription.reminderDays) {
          alerts.push({
            id: `trial-${subscription.id}-${subscription.trialEndDate}`,
            type: "trial",
            name: subscription.name,
            date: subscription.trialEndDate,
            daysOut: trialDays,
            amount: subscription.amount,
            color: subscription.color,
          });
        }
      }

      return alerts;
    })
    .sort((a, b) => a.daysOut - b.daysOut || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function subscriptionsToCsv(subscriptions) {
  const columns = [
    "name",
    "amount",
    "cycle",
    "nextBillingDate",
    "category",
    "tags",
    "color",
    "trialEndDate",
    "reminderDays",
    "paused",
  ];
  const rows = subscriptions.map((subscription) => [
    subscription.name,
    subscription.amount,
    subscription.cycle,
    subscription.nextBillingDate,
    subscription.category,
    subscription.tags.join("|"),
    subscription.color,
    subscription.trialEndDate,
    subscription.reminderDays,
    subscription.paused,
  ]);

  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function dayLabel(daysOut) {
  if (daysOut === 0) return "today";
  if (daysOut === 1) return "tomorrow";
  return `${daysOut} days`;
}

function initials(name) {
  return name
    .split(/\s|\+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Panel({ title, marker, action, children, className = "" }) {
  return (
    <section className={`border border-zinc-800 bg-black/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {marker && <span className="h-3 w-1 shrink-0 bg-amber-400" />}
          <h2 className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</h2>
        </div>
        <div className="min-w-0 shrink truncate text-right">{action}</div>
      </header>
      {children}
    </section>
  );
}

function StatCell({ label, value, sublabel, tone = "neutral", code }) {
  const toneClass = tone === "hot" ? "text-amber-300" : "text-zinc-50";

  return (
    <section className="relative border border-zinc-800 bg-black/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        {code && <div className="font-mono text-[10px] text-zinc-600">{code}</div>}
      </div>
      <div className={`mt-3 font-mono text-3xl font-black leading-none ${toneClass}`}>{value}</div>
      <div className="mt-2 border-t border-zinc-900 pt-2 text-xs text-zinc-500">{sublabel}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function LandingPage({ onOpen }) {
  const previewSubscriptions = seedSubscriptions.filter((subscription) => !subscription.paused).slice(0, 4);

  return (
    <main className="min-h-screen bg-[#08090a] text-zinc-100">
      <nav className="relative z-20 border-b border-zinc-800 bg-black">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between px-4 sm:px-6">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-lg font-black uppercase text-white">
            Outflow
          </button>
          <div className="flex items-center gap-5 text-xs font-bold uppercase text-zinc-500">
            <a href="#system" className="hidden hover:text-zinc-100 sm:block">System</a>
            <a href="#principles" className="hidden hover:text-zinc-100 sm:block">Principles</a>
            <button type="button" onClick={onOpen} className="border border-amber-400 bg-amber-400 px-3 py-2 text-black hover:bg-amber-300">
              Open tracker
            </button>
          </div>
        </div>
      </nav>

      <section className="relative min-h-[480px] overflow-hidden border-b border-zinc-800 min-[360px]:min-h-[560px] sm:min-h-[calc(100svh-96px)] sm:max-h-[780px]">
        <div className="absolute inset-0 grid content-center gap-5 px-3 opacity-25 sm:px-8" aria-hidden="true">
          {previewSubscriptions.map((subscription) => (
            <div key={subscription.id} className="grid min-h-28 gap-3 sm:grid-cols-[220px_minmax(0,1fr)_280px]">
              <div className="border border-violet-400 bg-violet-950 p-4">
                <div className="font-mono text-2xl font-black text-violet-100">{money(subscription.amount)}</div>
                <div className="mt-6 text-xs uppercase text-violet-300">{initials(subscription.name)} / {subscription.cycle}</div>
              </div>
              <div className="hidden border border-red-400 bg-red-950 p-4 sm:block">
                <div className="text-xl font-black uppercase text-red-50">{subscription.name}</div>
                <div className="mt-8 text-xs uppercase text-red-300">{subscription.category}</div>
              </div>
              <div className="hidden border border-emerald-400 bg-emerald-950 p-4 sm:block">
                <div className="font-mono text-2xl font-black text-emerald-100">{money(subscription.amount)}</div>
                <div className="mt-6 text-xs uppercase text-emerald-300">{shortDate(subscription.nextBillingDate)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-black/75" aria-hidden="true" />

        <div className="relative z-10 mx-auto flex min-h-[480px] max-w-[1560px] items-center px-4 py-5 min-[360px]:min-h-[560px] sm:min-h-[calc(100svh-96px)] sm:max-h-[780px] sm:px-6 sm:py-10">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex items-center gap-3 font-mono text-[10px] uppercase text-amber-300 sm:mb-4 sm:text-xs">
              <span className="h-3 w-1 bg-amber-400" />
              Personal recurring debit monitor
            </div>
            <h1 className="text-[48px] font-black uppercase leading-[0.9] text-white min-[360px]:text-6xl sm:text-8xl lg:text-9xl">Outflow</h1>
            <p className="mt-4 max-w-2xl text-base leading-6 text-zinc-300 sm:mt-6 sm:text-xl sm:leading-7">
              Know what is leaving your account, how much it costs, and exactly when it lands. One clear ledger for every recurring charge.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
              <button type="button" onClick={onOpen} className="border border-amber-400 bg-amber-400 px-2 py-3 text-[11px] font-black uppercase text-black hover:bg-amber-300 sm:px-5 sm:text-sm">
                Open your ledger
              </button>
              <a href="#system" className="border border-zinc-600 bg-black/70 px-2 py-3 text-center text-[11px] font-black uppercase text-zinc-200 hover:border-zinc-300 sm:px-5 sm:text-sm">
                See the system
              </a>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-zinc-700 pt-3 font-mono text-[10px] uppercase text-zinc-500 sm:mt-9 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-3 sm:pt-4 sm:text-xs">
              <span><b className="text-zinc-200">Local</b> by default</span>
              <span><b className="text-zinc-200">Zero</b> accounts</span>
              <span><b className="text-zinc-200">One</b> honest number</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-800 bg-amber-400 text-black">
        <div className="mx-auto grid max-w-[1560px] gap-1 px-4 py-4 font-mono text-xs uppercase sm:grid-cols-3 sm:px-6">
          <div><span className="font-black">01</span> See the monthly total</div>
          <div><span className="font-black">02</span> Read the next withdrawal</div>
          <div><span className="font-black">03</span> Control every subscription</div>
        </div>
      </section>

      <section id="system" className="border-b border-zinc-800 bg-[#0c0d0e] py-16 sm:py-24">
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div>
              <div className="font-mono text-xs uppercase text-amber-300">The system</div>
              <h2 className="mt-3 text-3xl font-black uppercase leading-tight text-white sm:text-4xl">Every charge, read left to right.</h2>
              <p className="mt-4 leading-7 text-zinc-500">Identity. Subscription. Withdrawal. Nothing hidden behind menus or charts.</p>
            </div>

            <div className="grid gap-3">
              {previewSubscriptions.slice(0, 3).map((subscription) => (
                <div key={subscription.id} className="grid gap-2 border border-zinc-800 bg-black p-2 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-3">
                  <div className="border border-violet-500/60 bg-violet-950/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center border border-violet-300 bg-black font-mono font-black text-violet-100">{initials(subscription.name)}</span>
                      <span className="font-mono text-xl font-black text-violet-100">{money(subscription.amount)}</span>
                    </div>
                  </div>
                  <div className="border border-red-500/60 bg-red-950/50 p-4">
                    <div className="text-lg font-black uppercase text-red-50">{subscription.name}</div>
                    <div className="mt-2 text-xs uppercase text-red-300/70">{subscription.category} / {subscription.cycle}</div>
                  </div>
                  <div className="border border-emerald-500/60 bg-emerald-950/50 p-4">
                    <div className="font-mono text-xl font-black text-emerald-100">{money(subscription.amount)}</div>
                    <div className="mt-2 text-xs uppercase text-emerald-300/70">Pulls {shortDate(subscription.nextBillingDate)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="principles" className="border-b border-zinc-800 bg-black py-16 sm:py-24">
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6">
          <div className="max-w-2xl">
            <div className="font-mono text-xs uppercase text-amber-300">Built for clarity</div>
            <h2 className="mt-3 text-3xl font-black uppercase text-white sm:text-4xl">A finance tool that stays out of your way.</h2>
          </div>
          <div className="mt-10 grid border border-zinc-800 md:grid-cols-3">
            {[
              ["Local first", "Your subscription data stays in this browser. No account or external service required."],
              ["Date aware", "Weekly, monthly, and yearly charges roll forward automatically when billing dates pass."],
              ["Action ready", "Pause, edit, or remove a subscription directly from the ledger whenever plans change."],
            ].map(([title, copy], index) => (
              <div key={title} className="border-b border-zinc-800 p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
                <div className="font-mono text-xs text-zinc-600">0{index + 1}</div>
                <h3 className="mt-8 text-lg font-black uppercase text-zinc-100">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-amber-400 py-14 text-black">
        <div className="mx-auto flex max-w-[1560px] flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <div className="font-mono text-xs uppercase">Your money is already moving.</div>
            <h2 className="mt-2 text-3xl font-black uppercase">See where it goes.</h2>
          </div>
          <button type="button" onClick={onOpen} className="border border-black bg-black px-5 py-3 text-sm font-black uppercase text-white hover:bg-zinc-900">
            Open Outflow
          </button>
        </div>
      </section>

      <footer className="border-t border-zinc-800 bg-black">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between px-4 py-5 text-xs uppercase text-zinc-600 sm:px-6">
          <span className="font-black text-zinc-300">Outflow</span>
          <span>Recurring debit monitor</span>
        </div>
      </footer>
    </main>
  );
}

function Tracker({ onExit }) {
  const [subscriptions, setSubscriptions] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : seedSubscriptions;
      return sanitizeSubscriptions(parsed).map((item) => normalizeBillingDate(item));
    } catch {
      return sanitizeSubscriptions(seedSubscriptions).map((item) => normalizeBillingDate(item));
    }
  });
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [forecastHorizon, setForecastHorizon] = useState(30);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported",
  );
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
  }, [subscriptions]);

  useEffect(() => {
    setSubscriptions((current) => current.map((item) => normalizeBillingDate(item)));
  }, []);

  const activeSubscriptions = useMemo(
    () => subscriptions.filter((subscription) => !subscription.paused),
    [subscriptions],
  );

  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((a, b) => {
        if (a.paused !== b.paused) return Number(a.paused) - Number(b.paused);
        return parseDate(a.nextBillingDate) - parseDate(b.nextBillingDate) || a.name.localeCompare(b.name);
      }),
    [subscriptions],
  );

  const timeline = useMemo(() => buildTimeline(subscriptions, 30), [subscriptions]);
  const forecastTimeline = useMemo(
    () => buildTimeline(subscriptions, forecastHorizon),
    [subscriptions, forecastHorizon],
  );
  const forecastWeeks = useMemo(
    () => weeklyForecast(forecastTimeline, forecastHorizon),
    [forecastTimeline, forecastHorizon],
  );
  const forecastCategories = useMemo(() => {
    const totals = new Map();
    forecastTimeline.forEach((event) => {
      const current = totals.get(event.category) || { name: event.category, total: 0, count: 0 };
      current.total += Number(event.amount);
      current.count += 1;
      totals.set(event.category, current);
    });
    return [...totals.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [forecastTimeline]);

  const calendarBounds = useMemo(() => monthBounds(calendarCursor), [calendarCursor]);
  const calendarGrid = useMemo(() => calendarDays(calendarCursor), [calendarCursor]);
  const calendarEvents = useMemo(
    () => buildSchedule(subscriptions, calendarBounds.start, calendarBounds.end),
    [subscriptions, calendarBounds],
  );
  const calendarEventsByDate = useMemo(() => {
    const eventsByDate = new Map();
    calendarEvents.forEach((event) => {
      const events = eventsByDate.get(event.date) || [];
      events.push(event);
      eventsByDate.set(event.date, events);
    });
    return eventsByDate;
  }, [calendarEvents]);
  const selectedDayEvents = calendarEventsByDate.get(selectedDate) || [];
  const upcomingWeek = timeline.filter((event) => event.daysOut <= 7);
  const monthlyTotal = activeSubscriptions.reduce((sum, item) => sum + monthlyEquivalent(item), 0);
  const yearlyRunRate = monthlyTotal * 12;
  const pausedCount = subscriptions.length - activeSubscriptions.length;
  const thirtyDayTotal = timeline.reduce((sum, event) => sum + Number(event.amount), 0);
  const forecastTotal = forecastTimeline.reduce((sum, event) => sum + Number(event.amount), 0);
  const forecastPeak = Math.max(...forecastWeeks.map((week) => week.total), 0);
  const forecastCategoryPeak = Math.max(...forecastCategories.map((category) => category.total), 0);
  const calendarMonthTotal = calendarEvents.reduce((sum, event) => sum + Number(event.amount), 0);
  const nextCharge = timeline[0];
  const alerts = useMemo(() => buildAlerts(subscriptions), [subscriptions]);

  useEffect(() => {
    if (notificationPermission !== "granted" || alerts.length === 0) return;

    try {
      const stored = JSON.parse(localStorage.getItem(NOTIFIED_ALERTS_KEY) || "[]");
      const notified = new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
      const pending = alerts.filter((alert) => !notified.has(alert.id));

      pending.forEach((alert) => {
        const title = alert.type === "trial" ? `${alert.name} trial ends ${dayLabel(alert.daysOut)}` : `${alert.name} bills ${dayLabel(alert.daysOut)}`;
        const body = alert.type === "trial"
          ? `${money(alert.amount)} expected after the trial ends on ${fullDate(alert.date)}.`
          : `${money(alert.amount)} will leave on ${fullDate(alert.date)}.`;
        new window.Notification(`Outflow / ${title}`, { body, tag: alert.id });
        notified.add(alert.id);
      });

      localStorage.setItem(NOTIFIED_ALERTS_KEY, JSON.stringify([...notified].slice(-200)));
    } catch {
      // Device notifications are best-effort; the in-app alert remains available.
    }
  }, [alerts, notificationPermission]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(blankForm);
    setEditingId(null);
  }

  function submitSubscription(event) {
    event.preventDefault();

    const payload = sanitizeSubscription({
      id: editingId || crypto.randomUUID(),
      name: form.name.trim(),
      amount: Number(form.amount),
      cycle: form.cycle,
      nextBillingDate: form.nextBillingDate,
      category: form.category.trim() || "Unsorted",
      tags: form.tags,
      color: form.color,
      trialEndDate: form.trialEndDate,
      reminderDays: Number(form.reminderDays),
      paused: form.paused,
    });

    if (!payload) return;

    const normalizedPayload = normalizeBillingDate(payload);

    setSubscriptions((current) =>
      editingId
        ? current.map((item) => (item.id === editingId ? normalizedPayload : item))
        : [...current, normalizedPayload].slice(0, MAX_SUBSCRIPTIONS),
    );
    resetForm();
  }

  function editSubscription(subscription) {
    setEditingId(subscription.id);
    setForm({
      name: subscription.name,
      amount: String(subscription.amount),
      cycle: subscription.cycle,
      nextBillingDate: subscription.nextBillingDate,
      category: subscription.category,
      tags: subscription.tags.join(", "),
      color: subscription.color,
      trialEndDate: subscription.trialEndDate,
      reminderDays: subscription.reminderDays,
      paused: subscription.paused,
    });
  }

  function deleteSubscription(id) {
    setSubscriptions((current) => current.filter((subscription) => subscription.id !== id));
    if (editingId === id) resetForm();
  }

  function togglePaused(id) {
    setSubscriptions((current) =>
      current.map((subscription) =>
        subscription.id === id
          ? normalizeBillingDate({ ...subscription, paused: !subscription.paused })
          : subscription,
      ),
    );
  }

  function moveCalendar(months) {
    setCalendarCursor((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + months, 1);
      setSelectedDate(toDateInput(next));
      return next;
    });
  }

  function showCurrentMonth() {
    const today = new Date();
    setCalendarCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(toDateInput(today));
  }

  async function requestDeviceAlerts() {
    if (!("Notification" in window)) return;
    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function exportCsv() {
    const blob = new Blob([subscriptionsToCsv(subscriptions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `outflow-subscriptions-${toDateInput(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <main className="min-h-screen text-zinc-200">
      <div className="mx-auto grid w-full max-w-[1560px] grid-cols-[minmax(0,1fr)] gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border border-zinc-800 bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:sticky lg:top-3 lg:h-fit">
          <header className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300">cashflow console</div>
                <h1 className="mt-1 text-3xl font-black uppercase leading-none tracking-[0.14em] text-zinc-50">Outflow</h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onExit}
                  className="border border-zinc-700 bg-black px-2 py-1 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-zinc-400 hover:text-zinc-100"
                >
                  Home
                </button>
                <div className="border border-amber-500 bg-amber-400 px-2 py-1 font-mono text-[10px] font-black text-black">
                  LIVE
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 border border-zinc-800 font-mono text-[11px]">
              <div className="border-r border-zinc-800 px-2 py-2">
                <div className="text-zinc-600">ACTIVE</div>
                <div className="text-zinc-100">{activeSubscriptions.length}</div>
              </div>
              <div className="border-r border-zinc-800 px-2 py-2">
                <div className="text-zinc-600">PAUSED</div>
                <div className="text-zinc-100">{pausedCount}</div>
              </div>
              <div className="px-2 py-2">
                <div className="text-zinc-600">LINES</div>
                <div className="text-zinc-100">{subscriptions.length}</div>
              </div>
            </div>
          </header>

          <form onSubmit={submitSubscription} className="grid gap-3 p-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">
                {editingId ? "Edit subscription" : "Add subscription"}
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="border border-zinc-700 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
                >
                  Clear
                </button>
              )}
            </div>

            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                maxLength={100}
                required
                placeholder="Figma, Slack, AWS..."
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-[1fr_1.25fr] lg:grid-cols-1 xl:grid-cols-[1fr_1.25fr]">
              <Field label="Amount">
                <input
                  type="number"
                  min="0.01"
                  max="1000000000"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => updateField("amount", event.target.value)}
                  required
                  placeholder="0.00"
                  className="h-10 border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
                />
              </Field>

              <div className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                Cycle
                <div className="grid h-10 grid-cols-3 border border-zinc-700 bg-zinc-950">
                  {cycles.map((cycle) => (
                    <button
                      key={cycle.value}
                      type="button"
                      aria-label={cycle.label}
                      aria-pressed={form.cycle === cycle.value}
                      title={cycle.label}
                      onClick={() => updateField("cycle", cycle.value)}
                      className={`border-r border-zinc-800 px-2 text-[11px] uppercase tracking-[0.08em] last:border-r-0 ${
                        form.cycle === cycle.value
                          ? "bg-amber-400 font-black text-black"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                      }`}
                    >
                      {cycle.value === "weekly" ? "Wk" : cycle.value === "monthly" ? "Mo" : "Yr"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Field label="Next billing date">
              <input
                type="date"
                value={form.nextBillingDate}
                onInput={(event) => updateField("nextBillingDate", event.currentTarget.value)}
                required
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-zinc-100 outline-none focus:border-amber-400"
              />
            </Field>

            <Field label="Category">
              <input
                value={form.category}
                onChange={(event) => updateField("category", event.target.value)}
                maxLength={60}
                placeholder="Streaming"
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <Field label="Tags">
              <input
                value={form.tags}
                onChange={(event) => updateField("tags", event.target.value)}
                maxLength={249}
                placeholder="personal, work, shared"
                className="h-10 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-400"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field label="Trial ends">
                <input
                  type="date"
                  value={form.trialEndDate}
                  onInput={(event) => updateField("trialEndDate", event.currentTarget.value)}
                  className="h-10 min-w-0 border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 outline-none focus:border-amber-400"
                />
              </Field>

              <Field label="Alert timing">
                <select
                  value={form.reminderDays}
                  onChange={(event) => updateField("reminderDays", Number(event.target.value))}
                  className="h-10 min-w-0 border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs text-zinc-100 outline-none focus:border-amber-400"
                >
                  {reminderOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Color tag">
              <div className="grid grid-cols-6 border border-zinc-800 bg-zinc-950" role="group" aria-label="Color tag">
                {colorTags.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    aria-label={tag.label}
                    aria-pressed={form.color === tag.value}
                    title={tag.label}
                    onClick={(event) => {
                      updateField("color", tag.value);
                      event.currentTarget.blur();
                    }}
                    className={`relative h-9 border-r border-zinc-800 outline-none last:border-r-0 ${
                      form.color === tag.value ? "bg-zinc-800" : "bg-black hover:bg-zinc-950"
                    }`}
                  >
                    <span className="mx-auto block h-3 w-5" style={{ background: tag.value }} />
                    {form.color === tag.value && (
                      <span className="absolute inset-x-2 bottom-1 h-0.5 bg-amber-300" />
                    )}
                  </button>
                ))}
              </div>
            </Field>

            <label className="flex h-10 items-center justify-between border border-zinc-800 bg-zinc-950 px-3 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Paused
              <input
                type="checkbox"
                checked={form.paused}
                onChange={(event) => updateField("paused", event.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
            </label>

            <button
              type="submit"
              className="h-11 border border-amber-400 bg-amber-400 px-3 text-xs font-black uppercase tracking-[0.18em] text-black hover:bg-amber-300"
            >
              {editingId ? "Commit changes" : "Add subscription"}
            </button>
          </form>
        </aside>

        <section className="grid min-w-0 gap-3">
          <header className="border border-zinc-800 bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">recurring debit monitor</div>
                <div className="mt-1 text-xl font-black uppercase tracking-[0.12em] text-zinc-50">Command Deck</div>
              </div>
              <div className="grid border border-zinc-800 font-mono text-xs sm:grid-cols-[auto_auto_auto]">
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  <span className="text-zinc-600">TODAY </span>
                  <span className="text-zinc-300">{shortDate(toDateInput(new Date()))}</span>
                </div>
                <div className="border-b border-zinc-800 px-3 py-2 sm:border-b-0 sm:border-r">
                  <span className="text-zinc-600">NEXT </span>
                  <span className="text-amber-300">{nextCharge ? `${nextCharge.name} ${dayLabel(nextCharge.daysOut)}` : "clear"}</span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-zinc-600">30D </span>
                  <span className="text-zinc-100">{money(thirtyDayTotal)}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-zinc-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                <span className="h-2 w-2 bg-emerald-400" />
                <span className="text-zinc-300">Local ledger</span>
                <span className="text-zinc-700">/</span>
                <span className="text-zinc-600">This browser</span>
              </div>
              <div className="flex items-center gap-2">
                {notificationPermission === "default" && (
                  <button
                    type="button"
                    onClick={requestDeviceAlerts}
                    className="border border-zinc-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-zinc-400 hover:border-amber-400 hover:text-amber-300"
                  >
                    Enable device alerts
                  </button>
                )}
                {notificationPermission !== "default" && (
                  <span className={`border px-2 py-1.5 font-mono text-[10px] font-black uppercase ${
                    notificationPermission === "granted"
                      ? "border-emerald-700 text-emerald-300"
                      : "border-zinc-800 text-zinc-600"
                  }`}>
                    Alerts {notificationPermission === "granted" ? "on" : notificationPermission}
                  </span>
                )}
                <button
                  type="button"
                  onClick={exportCsv}
                  className="border border-zinc-700 bg-black px-2 py-1.5 font-mono text-[10px] font-black uppercase text-zinc-300 hover:border-zinc-400 hover:text-white"
                >
                  Export CSV
                </button>
              </div>
            </div>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCell label="Monthly outflow" value={money(monthlyTotal)} sublabel={`${activeSubscriptions.length} active subscriptions`} tone="hot" code="MRC" />
            <StatCell label="Next charge" value={nextCharge ? money(nextCharge.amount) : "$0.00"} sublabel={nextCharge ? `${nextCharge.name} / ${fullDate(nextCharge.date)}` : "No active charges"} code="DUE" />
            <StatCell label="30 day pull" value={money(thirtyDayTotal)} sublabel={`${timeline.length} scheduled debit events`} code="T+30" />
            <StatCell label="Annualized" value={money(yearlyRunRate)} sublabel="Projected active run rate" code="ARR" />
          </div>

          <Panel title="Alerts" marker action={<span className="font-mono text-xs text-amber-300">{alerts.length}</span>}>
            <div className="grid divide-y divide-zinc-900 md:grid-cols-2 md:divide-x md:divide-y-0 md:divide-zinc-900">
              {alerts.length ? (
                alerts.map((alert) => (
                  <div key={alert.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0" style={{ background: alert.color }} />
                        <span className="truncate text-sm font-bold text-zinc-100">{alert.name}</span>
                        <span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                          alert.type === "trial" ? "border-cyan-800 text-cyan-300" : "border-amber-800 text-amber-300"
                        }`}>
                          {alert.type}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-zinc-500">
                        {alert.type === "trial" ? "Trial ends" : "Bills"} {fullDate(alert.date)} / {dayLabel(alert.daysOut)}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-black text-amber-300">{money(alert.amount)}</div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-6 text-sm text-zinc-500 md:col-span-2">No charges or trials inside the configured reminder windows.</div>
              )}
            </div>
          </Panel>

          <Panel
            title="Cash-out forecast"
            marker
            action={(
              <div className="grid grid-cols-3 border border-zinc-700" role="group" aria-label="Forecast horizon">
                {[30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={forecastHorizon === days}
                    onClick={() => setForecastHorizon(days)}
                    className={`border-r border-zinc-700 px-2 py-1 font-mono text-[10px] font-black last:border-r-0 ${
                      forecastHorizon === days ? "bg-amber-400 text-black" : "bg-black text-zinc-500 hover:text-zinc-100"
                    }`}
                  >
                    {days}D
                  </button>
                ))}
              </div>
            )}
          >
            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 border-b border-zinc-800 xl:border-b-0 xl:border-r">
                <div className="grid grid-cols-3 border-b border-zinc-800 font-mono">
                  <div className="border-r border-zinc-800 px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Scheduled</div>
                    <div className="mt-1 truncate text-sm font-black text-amber-300 sm:text-lg">{money(forecastTotal)}</div>
                  </div>
                  <div className="border-r border-zinc-800 px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Debits</div>
                    <div className="mt-1 text-sm font-black text-zinc-100 sm:text-lg">{forecastTimeline.length}</div>
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-[9px] uppercase text-zinc-600 sm:text-[10px]">Avg / week</div>
                    <div className="mt-1 truncate text-sm font-black text-zinc-100 sm:text-lg">
                      {money(forecastTotal / Math.max(forecastWeeks.length, 1))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 p-3">
                  <div className="grid grid-cols-[74px_minmax(0,1fr)_72px] gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-700 sm:grid-cols-[112px_minmax(0,1fr)_88px] sm:text-[10px]">
                    <span>Window</span>
                    <span>Pressure</span>
                    <span className="text-right">Pull</span>
                  </div>
                  {forecastWeeks.map((week) => {
                    const width = forecastPeak ? (week.total / forecastPeak) * 100 : 0;
                    return (
                      <div key={week.id} className="grid min-h-7 grid-cols-[74px_minmax(0,1fr)_72px] items-center gap-2 sm:grid-cols-[112px_minmax(0,1fr)_88px]">
                        <div className="truncate font-mono text-[9px] text-zinc-500 sm:text-[10px]">{week.label}</div>
                        <div className="h-2 bg-zinc-900">
                          <div className="h-full bg-amber-400" style={{ width: `${width}%` }} />
                        </div>
                        <div className="text-right font-mono text-[10px] font-bold text-zinc-300 sm:text-xs">
                          {money(week.total)}
                          <span className="ml-1 text-[9px] text-zinc-700">/{week.count}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0">
                <div className="border-b border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  Category load
                </div>
                <div className="grid gap-3 p-3">
                  {forecastCategories.length ? (
                    forecastCategories.map((category) => {
                      const width = forecastCategoryPeak ? (category.total / forecastCategoryPeak) * 100 : 0;
                      return (
                        <div key={category.name}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate font-bold uppercase text-zinc-400">{category.name}</span>
                            <span className="shrink-0 font-mono text-zinc-200">{money(category.total)}</span>
                          </div>
                          <div className="mt-1.5 flex h-1.5 bg-zinc-900">
                            <div className="bg-red-500" style={{ width: `${width}%` }} />
                          </div>
                          <div className="mt-1 font-mono text-[9px] uppercase text-zinc-700">{category.count} scheduled</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 text-sm text-zinc-600">No active charges in this forecast window.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Billing calendar"
            marker
            action={<span className="font-mono text-[10px] text-amber-300">{money(calendarMonthTotal)} / {calendarEvents.length}</span>}
          >
            <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Projected withdrawals</div>
                <div className="mt-1 text-lg font-black uppercase tracking-[0.08em] text-zinc-100">{monthLabel(calendarCursor)}</div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] border border-zinc-700 font-mono text-[10px] font-black uppercase">
                <button type="button" onClick={() => moveCalendar(-1)} className="border-r border-zinc-700 px-3 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">Prev</button>
                <button type="button" onClick={showCurrentMonth} className="border-r border-zinc-700 px-3 py-2 text-amber-300 hover:bg-zinc-900">Today</button>
                <button type="button" onClick={() => moveCalendar(1)} className="px-3 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">Next</button>
              </div>
            </div>

            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0">
                <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-950 font-mono text-[9px] uppercase text-zinc-600 sm:text-[10px]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="border-r border-zinc-800 px-1 py-2 text-center last:border-r-0">
                      <span className="sm:hidden">{day[0]}</span>
                      <span className="hidden sm:inline">{day}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 bg-zinc-800 gap-px">
                  {calendarGrid.map((date) => {
                    const value = toDateInput(date);
                    const events = calendarEventsByDate.get(value) || [];
                    const total = events.reduce((sum, event) => sum + Number(event.amount), 0);
                    const currentMonth = date.getMonth() === calendarCursor.getMonth();
                    const selected = selectedDate === value;
                    const today = value === toDateInput(new Date());

                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={`${fullDate(value)}${events.length ? `, ${events.length} ${events.length === 1 ? "charge" : "charges"} totaling ${money(total)}` : ", no charges"}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedDate(value);
                          if (!currentMonth) setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
                        }}
                        className={`relative min-h-16 min-w-0 bg-black p-1.5 text-left hover:bg-zinc-950 sm:min-h-24 sm:p-2 ${
                          currentMonth ? "" : "opacity-30"
                        } ${selected ? "shadow-[inset_0_0_0_1px_#fbbf24]" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-1 font-mono">
                          <span className={`text-[10px] sm:text-xs ${today ? "bg-amber-400 px-1 font-black text-black" : "text-zinc-500"}`}>
                            {date.getDate()}
                          </span>
                          {events.length > 0 && <span className="text-[8px] text-zinc-700 sm:text-[9px]">{events.length}X</span>}
                        </div>
                        {events.length > 0 && (
                          <div className="mt-2 min-w-0">
                            <div className="flex gap-0.5">
                              {events.slice(0, 3).map((event) => (
                                <span key={event.eventId} className="h-1 w-2 sm:h-1.5 sm:w-3" style={{ background: event.color }} />
                              ))}
                            </div>
                            <div className="mt-1 truncate font-mono text-[8px] font-black text-amber-300 sm:text-[10px]">{money(total)}</div>
                            <div className="mt-1 hidden truncate text-[9px] uppercase text-zinc-600 sm:block">{events[0].name}</div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0 border-t border-zinc-800 xl:border-l xl:border-t-0">
                <div className="border-b border-zinc-800 px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Selected day</div>
                  <div className="mt-1 font-mono text-sm font-black text-zinc-200">{fullDate(selectedDate)}</div>
                  <div className="mt-1 font-mono text-xs text-amber-300">
                    {money(selectedDayEvents.reduce((sum, event) => sum + Number(event.amount), 0))} / {selectedDayEvents.length} {selectedDayEvents.length === 1 ? "debit" : "debits"}
                  </div>
                </div>
                <div className="divide-y divide-zinc-900">
                  {selectedDayEvents.length ? (
                    selectedDayEvents.map((event) => (
                      <div key={event.eventId} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0" style={{ background: event.color }} />
                            <span className="truncate text-sm font-bold text-zinc-100">{event.name}</span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-600">{event.category} / {event.cycle}</div>
                        </div>
                        <div className="font-mono text-sm font-black text-amber-300">{money(event.amount)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-8 text-sm text-zinc-600">No withdrawals scheduled for this day.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
              <Panel
                title="Active subscriptions"
                marker
                action={<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">identity / subscription / withdrawal</span>}
              >
                <div className="grid gap-3 p-3">
                  <div className="hidden grid-cols-[220px_minmax(0,1fr)_280px] gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600 lg:grid">
                    <div>Logo / Plan</div>
                    <div>Subscription</div>
                    <div>Withdrawal</div>
                  </div>

                  {sortedSubscriptions.map((subscription) => {
                    const daysOut = daysBetween(toDateInput(new Date()), subscription.nextBillingDate);
                    const urgent = !subscription.paused && daysOut <= 7;

                    return (
                      <article
                        key={subscription.id}
                        className={`grid gap-2 border border-zinc-800 bg-zinc-950/70 p-2 transition hover:border-zinc-700 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-3 ${
                          subscription.paused ? "opacity-50" : ""
                        }`}
                      >
                        <div className="border border-violet-500/60 bg-violet-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="flex items-center justify-between gap-3">
                            <div
                              className="grid h-12 w-12 shrink-0 place-items-center border border-violet-300/70 bg-black font-mono text-sm font-black text-violet-200"
                              style={{ boxShadow: `inset 4px 0 0 ${subscription.color}` }}
                            >
                              {initials(subscription.name)}
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-xl font-black leading-none text-violet-100">{money(subscription.amount)}</div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-violet-300/70">
                                {subscription.cycle}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 border border-violet-400/20 font-mono text-[10px] uppercase">
                            <div className="border-r border-violet-400/20 px-2 py-1 text-violet-300/70">monthly eq.</div>
                            <div className="px-2 py-1 text-right text-violet-100">{money(monthlyEquivalent(subscription))}</div>
                          </div>
                          <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-violet-300/60">
                            Alert {subscription.reminderDays < 0 ? "off" : `${subscription.reminderDays}d before`}
                          </div>
                        </div>

                        <div className="border border-red-500/60 bg-red-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-lg font-black uppercase tracking-[0.08em] text-red-50">{subscription.name}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-200/70">
                                <span>{subscription.category}</span>
                                <span className="text-red-400/50">/</span>
                                <span className="font-mono uppercase">{subscription.cycle} billing</span>
                              </div>
                              {subscription.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {subscription.tags.map((tag) => (
                                    <span key={tag} className="border border-red-300/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-200/60">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {subscription.trialEndDate && (
                                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300/80">
                                  Trial ends {fullDate(subscription.trialEndDate)}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => togglePaused(subscription.id)}
                              className={`shrink-0 border px-2 py-1 font-mono text-[11px] uppercase ${
                                subscription.paused
                                  ? "border-zinc-600 bg-black/40 text-zinc-400 hover:text-zinc-100"
                                  : "border-red-300/50 bg-black/30 text-red-100 hover:border-red-100"
                              }`}
                            >
                              {subscription.paused ? "Paused" : "Active"}
                            </button>
                          </div>

                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editSubscription(subscription)}
                              className="border border-red-200/30 bg-black/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-red-100 hover:border-red-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSubscription(subscription.id)}
                              className="border border-red-300/50 bg-black/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-red-100 hover:border-red-100"
                            >
                              Del
                            </button>
                          </div>
                        </div>

                        <div className="border border-emerald-500/60 bg-emerald-950/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300/70">will pull</div>
                          <div className="mt-2 font-mono text-2xl font-black leading-none text-emerald-100">{money(subscription.amount)}</div>
                          <div className={`mt-3 border-t border-emerald-400/20 pt-3 font-mono ${urgent ? "text-amber-200" : "text-emerald-100"}`}>
                            <div className="text-lg font-black">{fullDate(subscription.nextBillingDate)}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-emerald-300/70">
                              {subscription.paused ? "paused schedule" : dayLabel(daysOut)}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Next 7 days" marker action={<span className="font-mono text-xs text-amber-300">{upcomingWeek.length}</span>}>
                <div className="grid divide-y divide-zinc-900 md:grid-cols-2 md:divide-x md:divide-y-0 md:divide-zinc-900">
                  {upcomingWeek.length ? (
                    upcomingWeek.map((event) => (
                      <div key={event.eventId} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 shrink-0" style={{ background: event.color }} />
                            <span className="truncate text-sm font-bold text-zinc-100">{event.name}</span>
                          </div>
                          <div className="mt-1 font-mono text-xs text-zinc-500">{fullDate(event.date)} / {dayLabel(event.daysOut)}</div>
                        </div>
                        <div className="font-mono text-sm font-black text-amber-300">{money(event.amount)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-sm text-zinc-500 md:col-span-2">No active charges inside the next week.</div>
                  )}
                </div>
              </Panel>
            </section>

            <Panel title="Upcoming 30" marker action={<span className="font-mono text-xs text-amber-300">{timeline.length}</span>} className="min-w-0">
              <div className="max-h-[640px] overflow-auto">
                {timeline.map((event) => (
                  <div key={event.eventId} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 border-b border-zinc-900 px-3 py-3">
                    <div className="font-mono text-xs text-zinc-500">
                      <div>{shortDate(event.date)}</div>
                      <div className="text-[10px] uppercase text-zinc-700">{dayLabel(event.daysOut)}</div>
                    </div>
                    <div className="min-w-0 border-l border-zinc-800 pl-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0" style={{ background: event.color }} />
                        <div className="truncate text-sm font-bold text-zinc-100">{event.name}</div>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">{event.category}</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-zinc-100">{money(event.amount)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function App() {
  const [trackerOpen, setTrackerOpen] = useState(() => window.location.hash === "#app");

  useEffect(() => {
    const syncView = () => setTrackerOpen(window.location.hash === "#app");
    window.addEventListener("popstate", syncView);
    window.addEventListener("hashchange", syncView);
    return () => {
      window.removeEventListener("popstate", syncView);
      window.removeEventListener("hashchange", syncView);
    };
  }, []);

  function navigateToTracker() {
    window.history.pushState(null, "", "#app");
    setTrackerOpen(true);
    window.scrollTo(0, 0);
  }

  function navigateHome() {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    setTrackerOpen(false);
    window.scrollTo(0, 0);
  }

  return trackerOpen ? <Tracker onExit={navigateHome} /> : <LandingPage onOpen={navigateToTracker} />;
}

export default App;
