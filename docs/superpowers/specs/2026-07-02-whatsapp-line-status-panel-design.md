# WhatsApp "מצב הקו" Rich Status Panel — Design

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Frontend only (`frontend/src/features/communication.tsx` + new logic module + CSS)

## Problem

The "מצב הקו" panel in the WhatsApp Hub shows a single text line when connected
("✅ הכול מחובר. המספר המקושר: …"). The backend status endpoint already returns
richer data (bridge state, session state, owner number, dry-run), and the view
already holds the dialogue messages and the daily-brief schedule — but none of
that is surfaced. The owner can't see at a glance *which* layer is healthy,
when the line was last active, or when the status was last checked.

## Decision

Upgrade the panel to a rich, read-only status card with a manual refresh
action. **No backend changes** — everything renders from data the frontend
already has:

- `/communication/whatsapp/status` → bridge, session, owner, dry_run
- `messages` prop (dialogue scope) → last inbound / outbound timestamps
- `/communication/daily-brief/schedule` → daily brief enabled + time

Rejected alternative: enriching the status endpoint with
`last_inbound_at`/`last_outbound_at`. More authoritative but touches backend +
tests for data the frontend can already derive from the loaded conversation.

## Panel layout (RTL, enterprise style)

```
חיבור · מצב הקו                    [↻ רענן]
───────────────────────────────────
 ● גשר Evolution        פעיל
 ● סשן WhatsApp         מחובר
 ● מספר מקושר           054-674-5182
───────────────────────────────────
 הודעה אחרונה ממך       היום 09:14
 הודעה אחרונה מ-Atlas    היום 08:00
 תדרוך יומי              פעיל · 08:00
───────────────────────────────────
 נבדק לאחרונה 12:41
```

### Group 1 — connection checklist (all hub states)

Three rows, each with a colored status dot (reuse the existing
green/amber/red/neutral palette from `.wa-state-dot`):

| Row | connected | needs_scan | bridge_down | unconfigured / loading |
|---|---|---|---|---|
| גשר Evolution | ● ירוק · פעיל | ● ירוק · פעיל | ● אדום · כבוי | ● נייטרלי · לא מוגדר / בודק… |
| סשן WhatsApp | ● ירוק · מחובר | ● כתום · דורש סריקת QR | ● נייטרלי · — | ● נייטרלי · — |
| מספר מקושר | ● ירוק · 054-674-5182 | ● נייטרלי · המספר | ● נייטרלי · המספר | ● נייטרלי · — |

Number comes from `status.owner` (msisdn like `972546745182`), formatted to
local Israeli form `054-674-5182`; falls back to
`DEFAULT_WHATSAPP_RECIPIENT_LOCAL`, and to the raw value if it isn't a
`9725…` msisdn.

The existing state-specific guidance remains below the checklist, unchanged in
behavior: QR scan flow (`needs_scan`), docker restart command (`bridge_down`),
create-provider button (`unconfigured`), dry-run chip.

### Group 2 — line activity (rendered whenever the hub is configured)

- **הודעה אחרונה ממך** — latest `created_at` where `direction === "inbound"`,
  formatted with the existing `formatActivityTime`; "עדיין לא" when none.
- **הודעה אחרונה מ-Atlas** — same for `direction === "outbound"`.
- **תדרוך יומי** — "פעיל · HH:MM" from the schedule endpoint, or "כבוי";
  hidden if the schedule fetch failed.

Derivation is limited to the 100 most recent dialogue messages the view
already loads — accepted trade-off of the frontend-only approach.

### Group 3 — footer

- "נבדק לאחרונה HH:MM" — set on every *successful* status fetch (initial
  load, QR polling, manual refresh).
- **↻ רענן** button — re-fetches status and schedule; disabled with a spinner
  affordance while in flight.

## Implementation shape

- **New:** `frontend/src/features/communication-logic.ts` — pure functions:
  - `formatIsraeliNumber(msisdn: string): string`
  - `lastMessageTimes(messages): { inbound: string | null; outbound: string | null }`
  - checklist row derivation: `(state: HubState, owner: string | null) => Row[]`
    where `Row = { key, label, accent, value }` — move `HubState`/`hubState`
    here so the logic is testable.
- **Changed:** `communication.tsx` — render the three groups from the logic
  module; add `lastChecked` state; wire the refresh button.
- **Changed:** `styles.css` — row styles under the existing `wa-*` namespace
  (e.g. `.wa-status-rows`, `.wa-status-row`, `.wa-status-dot`), muted
  enterprise look, no glow.

## Error handling

- Status fetch failure → state stays/returns to `loading` (current behavior);
  footer keeps showing the last successful check time.
- Empty conversation → "עדיין לא" values, rows still shown.
- Unparseable owner number → shown raw.

## Testing

TDD with vitest on `communication-logic.test.ts`, mirroring
`coach-logic.test.ts`:

- `formatIsraeliNumber`: `972546745182` → `054-674-5182`; non-IL msisdn →
  raw passthrough; empty → fallback handling.
- `lastMessageTimes`: empty list; inbound-only; outbound-only; picks latest
  by `created_at`, not array order.
- Checklist derivation: one case per hub state (connected / needs_scan /
  bridge_down / unconfigured / loading) asserting labels + accents.

Backend tests untouched. Manual visual check in the dev server (RTL layout,
all four states) before finishing.
