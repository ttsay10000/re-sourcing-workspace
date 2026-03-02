import { describe, it, expect } from "vitest";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";

/** Mirror of rowId logic in hpdViolations module for testing. */
function rowId(row: Record<string, unknown>): string {
  const id = row.violationid ?? row.violation_id ?? row.id;
  if (id != null) return String(id);
  return JSON.stringify({
    b: row.bbl ?? row.bin,
    s: row.story,
    c: row.class,
    d: row.approveddate ?? row.approved_date,
  });
}

describe("HPD Violations normalization and upsert key", () => {
  it("uses violationid as source_row_id when present", () => {
    expect(rowId({ violationid: "V-123" })).toBe("V-123");
    expect(rowId({ violation_id: "V-456" })).toBe("V-456");
    expect(rowId({ id: "V-789" })).toBe("V-789");
  });

  it("falls back to deterministic hash-like key when no id", () => {
    const key = rowId({
      bbl: "1000123456",
      story: "1",
      class: "B",
      approveddate: "2023-01-15",
    });
    expect(key).toContain("1000123456");
    expect(key).toContain("1");
    expect(key).toContain("B");
    expect(key).toContain("2023-01-15");
    const key2 = rowId({
      bbl: "1000123456",
      story: "1",
      class: "B",
      approveddate: "2023-01-15",
    });
    expect(key).toBe(key2);
  });
});

describe("parseDateToYyyyMmDd for HPD violations", () => {
  it("normalizes ISO date to YYYY-MM-DD", () => {
    expect(parseDateToYyyyMmDd("2023-06-15T00:00:00.000Z")).toBe("2023-06-15");
    expect(parseDateToYyyyMmDd("2023-06-15")).toBe("2023-06-15");
  });

  it("returns null for invalid or empty", () => {
    expect(parseDateToYyyyMmDd("")).toBeNull();
    expect(parseDateToYyyyMmDd(null)).toBeNull();
    expect(parseDateToYyyyMmDd("not-a-date")).toBeNull();
  });
});

describe("summary shape (byClass, rentImpairingOpen)", () => {
  it("computes counts by class from rows", () => {
    const rows = [
      { class: "A", currentstatus: "Open", rentimpairing: "Y" },
      { class: "B", currentstatus: "Closed", rentimpairing: "N" },
      { class: "A", currentstatus: "Open", rentimpairing: null },
    ];
    const byClass: Record<string, number> = {};
    let rentImpairingOpen = 0;
    let openCount = 0;
    for (const row of rows) {
      const c = (row as Record<string, unknown>).class ?? "unknown";
      byClass[String(c)] = (byClass[String(c)] ?? 0) + 1;
      const status = ((row as Record<string, unknown>).currentstatus ?? "").toString().toLowerCase();
      if (status.includes("open")) openCount++;
      const impairing = (row as Record<string, unknown>).rentimpairing;
      if (impairing === true || impairing === "Y" || impairing === "Yes") {
        if (status.includes("open")) rentImpairingOpen++;
      }
    }
    expect(byClass).toEqual({ A: 2, B: 1 });
    expect(openCount).toBe(2);
    expect(rentImpairingOpen).toBe(1);
  });
});
