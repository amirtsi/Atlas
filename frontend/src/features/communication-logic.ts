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
