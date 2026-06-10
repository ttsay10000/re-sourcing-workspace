import { describe, expect, it, vi, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { buildDealAnalysisWorkbook } from "./dealAnalysisWorkbook.js";
import { auditDealAnalysisWorkbook } from "./workbookAudit.js";
import { sampleContext } from "./__fixtures__/underwritingContextFixture.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auditDealAnalysisWorkbook", () => {
  it("passes (or only warns) for a freshly built workbook", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ctx = sampleContext();
    const { buffer } = await buildDealAnalysisWorkbook(ctx, { useLlmBlueprint: false });

    const audit = await auditDealAnalysisWorkbook({ buffer, ctx });
    const failed = audit.checks.filter((check) => check.status === "failed");
    expect(failed).toEqual([]);
    expect(["pass", "warnings"]).toContain(audit.status);
    expect(audit.checks.some((check) => check.key === "expense_tie_out_taxes")).toBe(true);
    expect(
      audit.checks.some((check) => check.key === "structure_net_operating_income_noi_" && check.status === "pass")
    ).toBe(true);
    expect(audit.checks.some((check) => check.key === "assumption_purchase_price" && check.status === "pass")).toBe(
      true
    );
    expect(audit.checks.some((check) => check.key === "assumption_current_noi" && check.status === "pass")).toBe(true);
    expect(audit.checks.some((check) => check.key === "formula_sanity" && check.status === "pass")).toBe(true);
  });

  it("fails the expense tie-out when the engine numbers diverge from the workbook", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ctx = sampleContext();
    const { buffer } = await buildDealAnalysisWorkbook(ctx, { useLlmBlueprint: false });

    // Pretend the engine now projects taxes 30% higher than what was rendered.
    const divergent = sampleContext();
    divergent.yearlyCashFlow!.expenseLineItems = divergent.yearlyCashFlow!.expenseLineItems.map((line) =>
      line.lineItem === "Taxes"
        ? { ...line, yearlyAmounts: line.yearlyAmounts.map((amount) => amount * 1.3) }
        : line
    );

    const audit = await auditDealAnalysisWorkbook({ buffer, ctx: divergent });
    expect(audit.status).toBe("failed");
    const taxFailure = audit.checks.find(
      (check) => check.key.startsWith("expense_tie_out_taxes_y") && check.status === "failed"
    );
    expect(taxFailure).toBeDefined();
    expect(taxFailure!.cell).toBeTruthy();
  });

  it("fails when the engine purchase price no longer matches the workbook input", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ctx = sampleContext();
    const { buffer } = await buildDealAnalysisWorkbook(ctx, { useLlmBlueprint: false });

    const divergent = sampleContext();
    divergent.assumptions.acquisition.purchasePrice = 1_250_000;

    const audit = await auditDealAnalysisWorkbook({ buffer, ctx: divergent });
    const purchaseCheck = audit.checks.find((check) => check.key === "assumption_purchase_price");
    expect(purchaseCheck).toBeDefined();
    expect(purchaseCheck!.status).toBe("failed");
  });

  it("warns when assumptions sit outside lending bounds", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ctx = sampleContext();
    ctx.assumptions.financing.ltvPct = 92;
    const { buffer } = await buildDealAnalysisWorkbook(ctx, { useLlmBlueprint: false });

    const audit = await auditDealAnalysisWorkbook({ buffer, ctx });
    const ltvCheck = audit.checks.find((check) => check.key === "bounds_ltv");
    expect(ltvCheck).toBeDefined();
    expect(ltvCheck!.status).toBe("warning");
    expect(audit.status === "warnings" || audit.status === "failed").toBe(true);
  });

  it("flags an exit cap below the going-in cap", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ctx = sampleContext();
    ctx.assetCapRate = 8;
    ctx.assumptions.exit.exitCapPct = 5;
    const { buffer } = await buildDealAnalysisWorkbook(ctx, { useLlmBlueprint: false });

    const audit = await auditDealAnalysisWorkbook({ buffer, ctx });
    const exitCheck = audit.checks.find((check) => check.key === "bounds_exit_cap");
    expect(exitCheck).toBeDefined();
    expect(exitCheck!.status).toBe("warning");
  });
});
