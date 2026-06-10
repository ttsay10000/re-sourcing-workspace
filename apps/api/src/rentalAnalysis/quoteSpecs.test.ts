import { describe, expect, it } from "vitest";
import { calendarMonthOf, dominantMonth, generateQuoteSpecs, nightsBetween } from "./quoteSpecs.js";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("generateQuoteSpecs", () => {
  it("produces 12 calendar-month and 12 rolling-30 specs starting next month", () => {
    const specs = generateQuoteSpecs({ now: NOW });
    const calendar = specs.filter((spec) => spec.quoteType === "calendar_month");
    const rolling = specs.filter((spec) => spec.quoteType === "rolling_30_nights");

    expect(calendar).toHaveLength(12);
    expect(rolling).toHaveLength(12);
    expect(calendar[0]).toMatchObject({ checkIn: "2026-07-01", checkOut: "2026-08-01" });
    expect(calendar[11]).toMatchObject({ checkIn: "2027-06-01", checkOut: "2027-07-01" });
    expect(rolling[0]).toMatchObject({ checkIn: "2026-07-15", nights: 30 });
  });

  it("handles year boundaries and month lengths via real date math", () => {
    const specs = generateQuoteSpecs({ now: new Date("2026-12-05T00:00:00Z"), monthsForward: 3 });
    const calendar = specs.filter((spec) => spec.quoteType === "calendar_month");
    expect(calendar[0]).toMatchObject({ checkIn: "2027-01-01", checkOut: "2027-02-01", nights: 31 });
    expect(calendar[1]).toMatchObject({ checkIn: "2027-02-01", checkOut: "2027-03-01", nights: 28 });
  });

  it("adds the 60/90/180 duration ladder only when requested", () => {
    const base = generateQuoteSpecs({ now: NOW });
    expect(base.some((spec) => spec.quoteType === "rolling_60_nights")).toBe(false);

    const ladder = generateQuoteSpecs({ now: NOW, includeDurationLadder: true });
    const ladderTypes = ladder.map((spec) => spec.quoteType);
    expect(ladderTypes).toContain("rolling_60_nights");
    expect(ladderTypes).toContain("rolling_90_nights");
    expect(ladderTypes).toContain("rolling_180_nights");
    const oneEighty = ladder.find((spec) => spec.quoteType === "rolling_180_nights");
    expect(oneEighty?.nights).toBe(180);
  });

  it("defaults to USD, 2 guests, no pets", () => {
    const [first] = generateQuoteSpecs({ now: NOW });
    expect(first).toMatchObject({ currency: "USD", guests: 2, pets: false });
  });
});

describe("date helpers", () => {
  it("nightsBetween counts nights", () => {
    expect(nightsBetween("2026-07-01", "2026-08-01")).toBe(31);
    expect(nightsBetween("2026-07-15", "2026-08-14")).toBe(30);
  });

  it("calendarMonthOf truncates", () => {
    expect(calendarMonthOf("2026-07-15")).toBe("2026-07");
  });

  it("dominantMonth picks the month with most nights", () => {
    expect(dominantMonth("2026-07-01", "2026-08-01")).toBe("2026-07");
    expect(dominantMonth("2026-07-20", "2026-08-19")).toBe("2026-08");
  });
});
