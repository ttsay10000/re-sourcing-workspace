import { describe, expect, it } from "vitest";
import {
  isForwardPipelineStatusMove,
  pipelineStatusRank,
  STATUS_TO_CANONICAL,
  UI_V2_STATUS_FUNNEL_RANK,
} from "@re-sourcing/contracts";
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
      "loi_sent",
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
    expect(STATUS_TO_CANONICAL.archived!.state).toBe("dead");
    expect(STATUS_TO_CANONICAL.rejected!.state).toBe("dead");
  });
});

describe("pipeline funnel rank", () => {
  it("ranks every ui-v2 status STATUS_TO_CANONICAL knows about", () => {
    for (const status of [
      "new",
      "screening",
      "interesting",
      "saved",
      "outreach",
      "awaiting_broker",
      "om_received",
      "underwriting",
      "dossier_generated",
      "tour_scheduled",
      "tour_completed_awaiting_inputs",
      "offer_review",
      "negotiation",
      "contract_signed",
      "deal_closed",
      "rejected",
      "archived",
    ]) {
      expect(UI_V2_STATUS_FUNNEL_RANK[status], status).toBeDefined();
    }
  });

  it("never lets automatic flows push a tour/offer-stage deal back to OM or outreach statuses", () => {
    for (const current of [
      "tour_scheduled",
      "tour_completed_awaiting_inputs",
      "offer_review",
      "negotiation",
      "contract_signed",
    ]) {
      expect(isForwardPipelineStatusMove(current, "om_received"), `${current} → om_received`).toBe(false);
      expect(isForwardPipelineStatusMove(current, "outreach"), `${current} → outreach`).toBe(false);
      expect(isForwardPipelineStatusMove(current, "saved"), `${current} → saved`).toBe(false);
      expect(isForwardPipelineStatusMove(current, "underwriting"), `${current} → underwriting`).toBe(false);
    }
  });

  it("still lets OM arrival advance pre-OM deals", () => {
    for (const current of [null, undefined, "", "new", "screening", "saved", "outreach", "awaiting_broker"]) {
      expect(isForwardPipelineStatusMove(current, "om_received"), `${current} → om_received`).toBe(true);
    }
  });

  it("treats lateral moves within one stage as not-forward", () => {
    expect(isForwardPipelineStatusMove("awaiting_broker", "outreach")).toBe(false);
    expect(isForwardPipelineStatusMove("dossier_generated", "underwriting")).toBe(false);
    expect(pipelineStatusRank("awaiting_broker")).toBe(pipelineStatusRank("outreach"));
  });

  it("ranks tour statuses ahead of every underwriting-era status", () => {
    for (const earlier of ["om_received", "underwriting", "dossier_generated"]) {
      expect(pipelineStatusRank("tour_scheduled")).toBeGreaterThan(pipelineStatusRank(earlier));
      expect(pipelineStatusRank("tour_completed_awaiting_inputs")).toBeGreaterThan(pipelineStatusRank(earlier));
    }
  });
});
