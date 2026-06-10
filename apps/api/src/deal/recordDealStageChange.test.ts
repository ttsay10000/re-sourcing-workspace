import { describe, expect, it } from "vitest";
import { STATUS_TO_CANONICAL } from "@re-sourcing/contracts";
import { DEAL_STAGES, isDealState } from "@re-sourcing/db";

describe("STATUS_TO_CANONICAL", () => {
  it("maps every status to a stage the db layer accepts", () => {
    for (const [status, target] of Object.entries(STATUS_TO_CANONICAL)) {
      expect(DEAL_STAGES, `stage for status "${status}"`).toContain(target.stage);
      expect(isDealState(target.state), `state for status "${status}"`).toBe(true);
    }
  });

  it("covers the full saved-deal flow", () => {
    for (const status of [
      "new",
      "saved",
      "outreach",
      "awaiting_broker",
      "underwriting",
      "tour_scheduled",
      "offer_review",
      "negotiation",
      "contract_signed",
      "deal_closed",
      "rejected",
    ]) {
      expect(STATUS_TO_CANONICAL[status], status).toBeDefined();
    }
  });

  it("terminal statuses leave the active state", () => {
    expect(STATUS_TO_CANONICAL.deal_closed!.state).toBe("closed");
    expect(STATUS_TO_CANONICAL.archived!.state).toBe("closed");
    expect(STATUS_TO_CANONICAL.rejected!.state).toBe("dead");
  });
});
