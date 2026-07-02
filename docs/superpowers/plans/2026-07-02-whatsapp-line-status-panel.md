# Rich WhatsApp "מצב הקו" Status Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-line "מצב הקו" body in the WhatsApp Hub with a rich, read-only status card: a 3-row connection checklist (bridge / session / linked number), line-activity rows (last message each direction + daily brief), and a footer with "נבדק לאחרונה" plus a manual refresh button.

**Architecture:** Frontend-only. All display data already reaches the view: `/communication/whatsapp/status` (bridge, session, owner, dry_run), the `messages` prop (dialogue conversation, direction + created_at), and `/communication/daily-brief/schedule`. Pure derivation logic goes in a new `communication-logic.ts` module (mirroring the existing `coach-logic.ts` pattern) so it is unit-testable; `communication.tsx` only renders.

**Tech Stack:** React 19 + TypeScript (Vite), vitest for logic tests, plain CSS in `frontend/src/styles.css` using the existing `wa-*` namespace and design tokens.

**Spec:** `docs/superpowers/specs/2026-07-02-whatsapp-line-status-panel-design.md`

## Global Constraints

- **No backend changes.** Do not touch `backend/`.
- **RTL Hebrew UI.** All user-facing strings are Hebrew, copied verbatim from this plan (they match the spec): "גשר Evolution", "סשן WhatsApp", "מספר מקושר", "פעיל", "מחובר", "דורש סריקת QR", "כבוי", "לא מוגדר", "בודק…", "—", "הודעה אחרונה ממך", "הודעה אחרונה מ-Atlas", "תדרוך יומי", "עדיין לא", "היום", "אתמול", "נבדק לאחרונה", "טרם נבדק", "רענן".
- **Enterprise aesthetic:** muted, professional; no glow/neon. Reuse existing dot colors `#34d399` (green), `#fbbf24` (orange), `#f87171` (red), `var(--text-muted)` (neutral) and existing tokens (`--sp-*`, `--fs-*`, `--r-*`, `--border-strong`, `--surface-1`, `--text-*`, `--fw-semibold`).
- **No fake/demo data** — every rendered value derives from real API data or is an honest empty state ("עדיין לא", "—", "טרם נבדק").
- All commands run from `frontend/`: `/Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend`.

---

### Task 1: Pure logic module `communication-logic.ts` (TDD)

**Files:**
- Create: `frontend/src/features/communication-logic.ts`
- Create: `frontend/src/features/communication-logic.test.ts`

**Interfaces:**
- Consumes: types `WhatsAppStatus`, `CommunicationMessage`, `DailyBriefSchedule` from `frontend/src/api/atlas.ts` (already exist).
- Produces (Task 2 imports all of these from `./communication-logic`):
  - `type HubState = "connected" | "needs_scan" | "bridge_down" | "unconfigured" | "loading"`
  - `hubState(status: WhatsAppStatus | null): HubState`
  - `type RowAccent = "green" | "orange" | "red" | "neutral"`
  - `type StatusRow = { key: string; label: string; value: string; accent: RowAccent }`
  - `formatIsraeliNumber(msisdn: string | null | undefined): string`
  - `lastMessageTimes(messages: CommunicationMessage[]): { inbound: string | null; outbound: string | null }`
  - `formatLineTime(iso: string | null, now: Date): string`
  - `lineChecklist(state: HubState, owner: string | null): StatusRow[]`
  - `dailyBriefLabel(schedule: DailyBriefSchedule | null): string | null`

Note: `HubState` and `hubState` are **moved** here from `communication.tsx` (currently defined at `communication.tsx:29-42`) so they are testable. Task 2 deletes the originals.

Note on `formatLineTime` test timestamps: they are deliberately timezone-naive (`"2026-07-02T09:14:00"`, no `Z`) so the same-day/yesterday math is deterministic in any timezone the test runs in.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/communication-logic.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { CommunicationMessage, WhatsAppStatus } from "../api/atlas";
import {
  dailyBriefLabel,
  formatIsraeliNumber,
  formatLineTime,
  hubState,
  lastMessageTimes,
  lineChecklist
} from "./communication-logic";

function message(direction: string, createdAt: string): CommunicationMessage {
  return {
    id: `m-${direction}-${createdAt}`,
    provider_id: "p1",
    direction,
    channel: "whatsapp",
    recipient: null,
    sender: null,
    content_text: "hi",
    status: "sent",
    provider_message_id: null,
    error: null,
    metadata: {},
    created_at: createdAt,
    updated_at: createdAt
  };
}

function waStatus(partial: Partial<WhatsAppStatus>): WhatsAppStatus {
  return {
    configured: true,
    bridge: "up",
    session: "open",
    owner: "972546745182",
    detail: null,
    ...partial
  };
}

describe("hubState", () => {
  it("is loading without a status", () => {
    expect(hubState(null)).toBe("loading");
  });

  it("is unconfigured when no provider is configured", () => {
    expect(hubState(waStatus({ configured: false, bridge: "unconfigured" }))).toBe("unconfigured");
  });

  it("is bridge_down when the bridge is down", () => {
    expect(hubState(waStatus({ bridge: "down", session: null }))).toBe("bridge_down");
  });

  it("is connected when the session is open", () => {
    expect(hubState(waStatus({}))).toBe("connected");
  });

  it("needs a scan when the bridge is up but the session is not open", () => {
    expect(hubState(waStatus({ session: "connecting" }))).toBe("needs_scan");
  });
});

describe("formatIsraeliNumber", () => {
  it("formats an Israeli mobile msisdn to local form", () => {
    expect(formatIsraeliNumber("972546745182")).toBe("054-674-5182");
  });

  it("ignores punctuation and spaces before formatting", () => {
    expect(formatIsraeliNumber("+972 54-674-5182")).toBe("054-674-5182");
  });

  it("passes a non-Israeli number through raw", () => {
    expect(formatIsraeliNumber("14155550100")).toBe("14155550100");
  });

  it("returns an em dash for missing values", () => {
    expect(formatIsraeliNumber(null)).toBe("—");
    expect(formatIsraeliNumber("")).toBe("—");
  });
});

describe("lastMessageTimes", () => {
  it("returns nulls for an empty conversation", () => {
    expect(lastMessageTimes([])).toEqual({ inbound: null, outbound: null });
  });

  it("handles a one-direction conversation", () => {
    const result = lastMessageTimes([message("inbound", "2026-07-02T09:14:00")]);
    expect(result).toEqual({ inbound: "2026-07-02T09:14:00", outbound: null });
  });

  it("picks the latest timestamp per direction, not array order", () => {
    const result = lastMessageTimes([
      message("outbound", "2026-07-02T08:00:00"),
      message("inbound", "2026-07-01T22:10:00"),
      message("inbound", "2026-07-02T09:14:00"),
      message("outbound", "2026-07-01T08:00:00")
    ]);
    expect(result).toEqual({ inbound: "2026-07-02T09:14:00", outbound: "2026-07-02T08:00:00" });
  });
});

describe("formatLineTime", () => {
  const now = new Date("2026-07-02T12:00:00");

  it("says עדיין לא when there is no timestamp", () => {
    expect(formatLineTime(null, now)).toBe("עדיין לא");
  });

  it("says עדיין לא for an unparseable timestamp", () => {
    expect(formatLineTime("not-a-date", now)).toBe("עדיין לא");
  });

  it("prefixes today's times with היום", () => {
    expect(formatLineTime("2026-07-02T09:14:00", now)).toBe("היום 09:14");
  });

  it("prefixes yesterday's times with אתמול", () => {
    expect(formatLineTime("2026-07-01T18:02:00", now)).toBe("אתמול 18:02");
  });

  it("shows day.month for older times", () => {
    expect(formatLineTime("2026-06-12T18:02:00", now)).toBe("12.06 18:02");
  });
});

describe("lineChecklist", () => {
  it("shows all green when connected", () => {
    expect(lineChecklist("connected", "972546745182")).toEqual([
      { key: "bridge", label: "גשר Evolution", value: "פעיל", accent: "green" },
      { key: "session", label: "סשן WhatsApp", value: "מחובר", accent: "green" },
      { key: "number", label: "מספר מקושר", value: "054-674-5182", accent: "green" }
    ]);
  });

  it("flags the session when a scan is needed", () => {
    expect(lineChecklist("needs_scan", "972546745182")).toEqual([
      { key: "bridge", label: "גשר Evolution", value: "פעיל", accent: "green" },
      { key: "session", label: "סשן WhatsApp", value: "דורש סריקת QR", accent: "orange" },
      { key: "number", label: "מספר מקושר", value: "054-674-5182", accent: "neutral" }
    ]);
  });

  it("flags the bridge when it is down", () => {
    expect(lineChecklist("bridge_down", "972546745182")).toEqual([
      { key: "bridge", label: "גשר Evolution", value: "כבוי", accent: "red" },
      { key: "session", label: "סשן WhatsApp", value: "—", accent: "neutral" },
      { key: "number", label: "מספר מקושר", value: "054-674-5182", accent: "neutral" }
    ]);
  });

  it("shows an unconfigured hub as neutral", () => {
    expect(lineChecklist("unconfigured", null)).toEqual([
      { key: "bridge", label: "גשר Evolution", value: "לא מוגדר", accent: "neutral" },
      { key: "session", label: "סשן WhatsApp", value: "—", accent: "neutral" },
      { key: "number", label: "מספר מקושר", value: "—", accent: "neutral" }
    ]);
  });

  it("shows a checking state while loading", () => {
    expect(lineChecklist("loading", null)).toEqual([
      { key: "bridge", label: "גשר Evolution", value: "בודק…", accent: "neutral" },
      { key: "session", label: "סשן WhatsApp", value: "—", accent: "neutral" },
      { key: "number", label: "מספר מקושר", value: "—", accent: "neutral" }
    ]);
  });
});

describe("dailyBriefLabel", () => {
  it("labels an enabled schedule with its time", () => {
    expect(dailyBriefLabel({ enabled: true, time: "08:00", timezone: "Asia/Jerusalem", next_run: null })).toBe(
      "פעיל · 08:00"
    );
  });

  it("labels a disabled schedule", () => {
    expect(dailyBriefLabel({ enabled: false, time: "08:00", timezone: "Asia/Jerusalem", next_run: null })).toBe("כבוי");
  });

  it("returns null when the schedule is unknown", () => {
    expect(dailyBriefLabel(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npx vitest run src/features/communication-logic.test.ts`

Expected: FAIL — cannot resolve `./communication-logic` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/features/communication-logic.ts`:

```typescript
import type { CommunicationMessage, DailyBriefSchedule, WhatsAppStatus } from "../api/atlas";

export type HubState = "connected" | "needs_scan" | "bridge_down" | "unconfigured" | "loading";

export function hubState(status: WhatsAppStatus | null): HubState {
  if (!status) {
    return "loading";
  }
  if (!status.configured || status.bridge === "unconfigured") {
    return "unconfigured";
  }
  if (status.bridge === "down") {
    return "bridge_down";
  }
  return status.session === "open" ? "connected" : "needs_scan";
}

export type RowAccent = "green" | "orange" | "red" | "neutral";

export type StatusRow = { key: string; label: string; value: string; accent: RowAccent };

// "972546745182" -> "054-674-5182"; anything that isn't an Israeli mobile msisdn passes through raw.
export function formatIsraeliNumber(msisdn: string | null | undefined): string {
  const raw = (msisdn ?? "").trim();
  if (!raw) {
    return "—";
  }
  const digits = raw.replace(/\D/g, "");
  if (!/^9725\d{8}$/.test(digits)) {
    return raw;
  }
  const local = `0${digits.slice(3)}`;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

export function lastMessageTimes(messages: CommunicationMessage[]): {
  inbound: string | null;
  outbound: string | null;
} {
  let inbound: string | null = null;
  let outbound: string | null = null;
  for (const message of messages) {
    if (message.direction === "inbound") {
      if (!inbound || message.created_at > inbound) {
        inbound = message.created_at;
      }
    } else if (message.direction === "outbound") {
      if (!outbound || message.created_at > outbound) {
        outbound = message.created_at;
      }
    }
  }
  return { inbound, outbound };
}

const TIME_FORMAT = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
const DAY_MONTH_FORMAT = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" });

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Day-aware short time: "היום 09:14", "אתמול 18:02", or "12.06 18:02".
export function formatLineTime(iso: string | null, now: Date): string {
  if (!iso) {
    return "עדיין לא";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "עדיין לא";
  }
  const time = TIME_FORMAT.format(date);
  if (dayKey(date) === dayKey(now)) {
    return `היום ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) {
    return `אתמול ${time}`;
  }
  return `${DAY_MONTH_FORMAT.format(date)} ${time}`;
}

// The connection chain, top to bottom: bridge process -> phone session -> linked number.
export function lineChecklist(state: HubState, owner: string | null): StatusRow[] {
  const number = formatIsraeliNumber(owner);
  const bridge = (value: string, accent: RowAccent): StatusRow => ({ key: "bridge", label: "גשר Evolution", value, accent });
  const session = (value: string, accent: RowAccent): StatusRow => ({ key: "session", label: "סשן WhatsApp", value, accent });
  const linked = (value: string, accent: RowAccent): StatusRow => ({ key: "number", label: "מספר מקושר", value, accent });

  switch (state) {
    case "connected":
      return [bridge("פעיל", "green"), session("מחובר", "green"), linked(number, "green")];
    case "needs_scan":
      return [bridge("פעיל", "green"), session("דורש סריקת QR", "orange"), linked(number, "neutral")];
    case "bridge_down":
      return [bridge("כבוי", "red"), session("—", "neutral"), linked(number, "neutral")];
    case "unconfigured":
      return [bridge("לא מוגדר", "neutral"), session("—", "neutral"), linked(number, "neutral")];
    case "loading":
      return [bridge("בודק…", "neutral"), session("—", "neutral"), linked(number, "neutral")];
  }
}

export function dailyBriefLabel(schedule: DailyBriefSchedule | null): string | null {
  if (!schedule) {
    return null;
  }
  return schedule.enabled ? `פעיל · ${schedule.time}` : "כבוי";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npx vitest run src/features/communication-logic.test.ts`

Expected: PASS — all tests green.

Also run the full frontend suite to confirm nothing else broke:

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npm test`

Expected: PASS (coach-logic, onboarding-logic, communication-logic).

- [ ] **Step 5: Commit**

```bash
cd /Users/amirtzibulevski/Desktop/Atlas/Atlas
git add frontend/src/features/communication-logic.ts frontend/src/features/communication-logic.test.ts
git commit -m "feat(web): pure derivation logic for the WhatsApp line-status panel"
```

---

### Task 2: Render the rich panel in `communication.tsx` + CSS

**Files:**
- Modify: `frontend/src/features/communication.tsx`
- Modify: `frontend/src/styles.css` (append after the `.wa-error` rule, before the `@media (max-width: 900px)` block at ~line 2427)

**Interfaces:**
- Consumes from `./communication-logic` (created in Task 1): `HubState`, `hubState`, `lineChecklist`, `lastMessageTimes`, `formatLineTime`, `formatIsraeliNumber` (indirectly via `lineChecklist`), `dailyBriefLabel`.
- Produces: no new exports — UI only.

- [ ] **Step 1: Rewire imports and remove the local hub-state logic**

In `frontend/src/features/communication.tsx`:

Replace the lucide import (line 2) — `MessageCircle` is no longer used (the panel-icon becomes the refresh button):

```typescript
import { ArrowDownToLine, ArrowUpFromLine, QrCode, RefreshCw, Send } from "lucide-react";
```

In the `../api/atlas` import block (lines 3-14), remove `DEFAULT_WHATSAPP_RECIPIENT_LOCAL` (its only use was the connected-state paragraph, which this task deletes). Keep everything else:

```typescript
import {
  type CommunicationMessage,
  type CommunicationProvider,
  type DailyBriefSchedule,
  type WhatsAppQr,
  type WhatsAppStatus,
  DEFAULT_WHATSAPP_RECIPIENT,
  getDailyBriefSchedule,
  getWhatsAppStatus,
  requestWhatsAppQr
} from "../api/atlas";
```

Add the logic-module import after the `../shared/format` import (line 16):

```typescript
import { type HubState, dailyBriefLabel, formatLineTime, hubState, lastMessageTimes, lineChecklist } from "./communication-logic";
```

Delete the local `HubState` type and `hubState` function (lines 29-42) — they now live in `communication-logic.ts`. Keep `STATE_LABEL` (it types against the imported `HubState`).

- [ ] **Step 2: Add lastChecked/refresh state and derived values**

Still in `communication.tsx`, inside `CommunicationView`:

Add two state hooks next to the existing ones (after the `schedule` state, line 70):

```typescript
const [lastChecked, setLastChecked] = useState<Date | null>(null);
const [refreshBusy, setRefreshBusy] = useState(false);
```

Replace `refreshStatus` (lines 79-85) so a successful check stamps the time:

```typescript
const refreshStatus = useCallback(async () => {
  try {
    setStatus(await getWhatsAppStatus());
    setLastChecked(new Date());
  } catch {
    setStatus(null);
  }
}, []);

const refreshSchedule = useCallback(async () => {
  try {
    setSchedule(await getDailyBriefSchedule());
  } catch {
    setSchedule(null);
  }
}, []);
```

Replace the initial-load effect (lines 87-90) to use the new callback:

```typescript
useEffect(() => {
  refreshStatus();
  refreshSchedule();
}, [refreshStatus, refreshSchedule]);
```

Add the manual refresh handler next to `showQr`:

```typescript
async function refreshLine() {
  setRefreshBusy(true);
  try {
    await Promise.all([refreshStatus(), refreshSchedule()]);
  } finally {
    setRefreshBusy(false);
  }
}
```

Add derived values right after `const stateMeta = STATE_LABEL[state];` (line 77):

```typescript
const checklist = lineChecklist(state, status?.owner ?? (status?.configured ? DEFAULT_WHATSAPP_RECIPIENT : null));
const lastTimes = lastMessageTimes(messages);
const briefLabel = dailyBriefLabel(schedule);
const renderedAt = new Date();
```

(`DEFAULT_WHATSAPP_RECIPIENT` is the msisdn fallback when a configured status lacks `owner`; `formatIsraeliNumber` inside `lineChecklist` renders it as the local `054-…` form the spec asks for.)

- [ ] **Step 3: Replace the panel body JSX**

Replace the whole "מצב הקו" panel `<section className="panel">…</section>` (lines 155-229) with:

```tsx
<section className="panel">
  <div className="panel-content wa-card">
    <header className="panel-header">
      <div>
        <span className="panel-eyebrow">חיבור</span>
        <h2>מצב הקו</h2>
      </div>
      <button className="wa-refresh" type="button" onClick={refreshLine} disabled={refreshBusy}>
        <RefreshCw size={15} className={refreshBusy ? "wa-spin" : undefined} aria-hidden="true" />
        רענן
      </button>
    </header>

    <div className="wa-status-rows" role="list" aria-label="שרשרת החיבור">
      {checklist.map((row) => (
        <div className="wa-status-row" role="listitem" key={row.key}>
          <span className={`wa-status-dot wa-dot-${row.accent}`} aria-hidden="true" />
          <span className="wa-status-label">{row.label}</span>
          <span className="wa-status-value" dir="auto">
            {row.value}
          </span>
        </div>
      ))}
    </div>

    {status?.configured ? (
      <div className="wa-status-rows" aria-label="פעילות הקו">
        <div className="wa-status-row">
          <span className="wa-status-label">הודעה אחרונה ממך</span>
          <span className="wa-status-value">{formatLineTime(lastTimes.inbound, renderedAt)}</span>
        </div>
        <div className="wa-status-row">
          <span className="wa-status-label">הודעה אחרונה מ-Atlas</span>
          <span className="wa-status-value">{formatLineTime(lastTimes.outbound, renderedAt)}</span>
        </div>
        {briefLabel ? (
          <div className="wa-status-row">
            <span className="wa-status-label">תדרוך יומי</span>
            <span className="wa-status-value">{briefLabel}</span>
          </div>
        ) : null}
      </div>
    ) : null}

    {state === "needs_scan" ? (
      <div className="wa-connect">
        <p className="wa-explain">
          📷 הגשר פעיל אבל WhatsApp לא מקושר. סרוק קוד QR מהטלפון:
          <br />
          <small>WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר</small>
        </p>
        {qr?.qr_base64 ? (
          <img className="wa-qr" src={qr.qr_base64} alt="קוד QR לקישור WhatsApp" />
        ) : qr?.error ? (
          <p className="quick-log-error">{qr.error}</p>
        ) : null}
        <button className="quick-submit" type="button" disabled={qrBusy} onClick={showQr}>
          {qr?.qr_base64 ? (
            <>
              <RefreshCw size={16} /> רענן קוד (פג תוך ~40 שניות)
            </>
          ) : (
            <>
              <QrCode size={16} /> הצג קוד QR לסריקה
            </>
          )}
        </button>
      </div>
    ) : null}

    {state === "bridge_down" ? (
      <p className="wa-explain">
        🔴 הגשר (Evolution) לא רץ על המחשב, אז הודעות לא יכולות לצאת או להיכנס. בדרך כלל זה אומר ש-Docker כבוי.
        <br />
        <small dir="ltr">
          colima start && docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
        </small>
      </p>
    ) : null}

    {state === "unconfigured" ? (
      <div className="wa-connect">
        <p className="wa-explain">
          ⚙️ עדיין אין חיבור מוגדר ל-WhatsApp. ראה <code>docs/whatsapp-two-way-setup.md</code> להקמה.
        </p>
        {!provider ? (
          <button className="quick-submit" type="button" disabled={isSaving} onClick={onCreateProvider}>
            צור חיבור WhatsApp
          </button>
        ) : null}
      </div>
    ) : null}

    {status?.dry_run && state !== "unconfigured" ? (
      <p className="wa-explain">
        <Chip accent="orange">dry-run</Chip> מצב תרגול — הודעות לא באמת נשלחות.
      </p>
    ) : null}

    <footer className="wa-status-footer">
      {lastChecked ? `נבדק לאחרונה ${formatActivityTime(lastChecked.toISOString())}` : "טרם נבדק"}
    </footer>
  </div>
</section>
```

Everything from `{state === "needs_scan" ?` through the dry-run chip is byte-identical to the current code — only the connected-state paragraph (`✅ הכול מחובר…`) is gone (replaced by the checklist), and the new rows/footer/refresh wrap around the untouched guidance blocks.

- [ ] **Step 4: Add the CSS**

In `frontend/src/styles.css`, insert after the `.wa-error` rule (~line 2425) and before the `@media (max-width: 900px)` block:

```css
.wa-status-rows {
  display: grid;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-strong);
}

.wa-status-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-md);
}

.wa-status-label {
  color: var(--text-secondary);
}

.wa-status-value {
  margin-inline-start: auto;
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
}

.wa-status-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--r-pill);
}

.wa-dot-green { background: #34d399; }
.wa-dot-orange { background: #fbbf24; }
.wa-dot-red { background: #f87171; }
.wa-dot-neutral { background: var(--text-muted); }

.wa-refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--surface-1);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.wa-refresh:hover:not(:disabled) {
  color: var(--text-primary);
}

.wa-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}

.wa-spin {
  animation: wa-spin 1s linear infinite;
}

@keyframes wa-spin {
  to {
    transform: rotate(360deg);
  }
}

.wa-status-footer {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
```

- [ ] **Step 5: Verify — tests, typecheck, build**

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npm test`
Expected: PASS — all suites, including `communication-logic.test.ts`.

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npm run build`
Expected: clean TypeScript compile + Vite build, no errors (this catches the removed imports/types).

- [ ] **Step 6: Visual check in the dev server**

Start the frontend dev server (backend on :8000 should be the Desktop copy per project convention; if it isn't running, the panel's loading/"בודק…" and "הגשר כבוי" paths are what you'll see — that is itself a valid visual check of a non-connected state):

Run: `cd /Users/amirtzibulevski/Desktop/Atlas/Atlas/frontend && npm run dev`

Open the WhatsApp view and confirm, RTL layout intact:
- Checklist shows three rows with dots; connected state is all green with the number as `054-674-5182`.
- Activity rows show "היום HH:MM"-style times or "עדיין לא".
- "תדרוך יומי" row shows "פעיל · 08:00" (or "כבוי").
- Footer shows "נבדק לאחרונה HH:MM"; clicking רענן spins the icon and updates the time.
- No glow/neon; matches surrounding panels.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
cd /Users/amirtzibulevski/Desktop/Atlas/Atlas
git add frontend/src/features/communication.tsx frontend/src/styles.css
git commit -m "feat(web): rich WhatsApp line-status panel with checklist, activity and refresh"
```
