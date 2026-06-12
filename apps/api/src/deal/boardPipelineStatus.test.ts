import { describe, expect, it } from "vitest";
import { deriveBoardPipelineStatus } from "./boardPipelineStatus.js";

function details(pipeline: Record<string, unknown>): Record<string, unknown> {
  return { pipeline };
}

describe("deriveBoardPipelineStatus", () => {
  it("returns the explicit uiV2Status written by board moves", () => {
    expect(deriveBoardPipelineStatus({ details: details({ uiV2Status: "tour_scheduled" }) })).toBe("tour_scheduled");
    expect(deriveBoardPipelineStatus({ details: details({ uiV2Status: "offer_review" }) })).toBe("offer_review");
  });

  it("prefers uiV2Status over a stale saved-deal status", () => {
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting" }),
        savedDealStatus: "saved",
      })
    ).toBe("underwriting");
  });

  it("treats an active rejection as rejected regardless of other signals", () => {
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting" }),
        hasActiveRejection: true,
      })
    ).toBe("rejected");
    expect(deriveBoardPipelineStatus({ details: details({ rejectedAt: "2026-01-01T00:00:00Z" }) })).toBe("rejected");
    expect(deriveBoardPipelineStatus({ details: details({ status: "rejected_removed" }) })).toBe("rejected");
  });

  it("lets deal-path tour signals steer the stage", () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting", dealPath: { tourScheduledAt: future } }),
      })
    ).toBe("tour_scheduled");
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting", dealPath: { tourScheduledAt: past } }),
      })
    ).toBe("tour_completed_awaiting_inputs");
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting", dealPath: { postTourDecision: "move_forward" } }),
      })
    ).toBe("offer_review");
  });

  it("ignores deal-path signals once the status is terminal or canceled", () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "deal_closed", dealPath: { tourScheduledAt: future } }),
      })
    ).toBe("deal_closed");
    expect(
      deriveBoardPipelineStatus({
        details: details({ uiV2Status: "underwriting", dealPath: { status: "canceled", tourScheduledAt: future } }),
      })
    ).toBe("underwriting");
  });

  it("falls back to saved-deal status specials, then the legacy status map", () => {
    expect(deriveBoardPipelineStatus({ details: null, savedDealStatus: "dossier_generated" })).toBe("dossier_generated");
    expect(deriveBoardPipelineStatus({ details: null, savedDealStatus: "rejected" })).toBe("rejected");
    expect(deriveBoardPipelineStatus({ details: null, savedDealStatus: "saved" })).toBe("saved");
    expect(deriveBoardPipelineStatus({ details: details({ status: "om_requested" }) })).toBe("outreach");
    expect(deriveBoardPipelineStatus({ details: details({ status: "loi_sent" }) })).toBe("offer_review");
    expect(deriveBoardPipelineStatus({ details: null })).toBe("new");
  });
});
