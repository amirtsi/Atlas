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
