import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildDealAnalysisWorkbook } from "./dealAnalysisWorkbook.js";
import type { UnderwritingContext } from "./underwritingContext.js";
import { sampleContext } from "./__fixtures__/underwritingContextFixture.js";

function findRowByLabel(worksheet: ExcelJS.Worksheet | undefined, label: string): number | null {
  if (!worksheet) return null;
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (worksheet.getCell(`A${row}`).value === label) {
      return row;
    }
  }
  return null;
}

function workbookFormulas(workbook: ExcelJS.Workbook): string[] {
  const formulas: string[] = [];
  workbook.worksheets.forEach((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (value && typeof value === "object" && "formula" in value && typeof value.formula === "string") {
          formulas.push(value.formula);
        }
      });
    });
  });
  return formulas;
}


afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildDealAnalysisWorkbook", () => {
  it("creates a styled workbook with visible analysis tabs and auditable model tabs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const { buffer } = await buildDealAnalysisWorkbook(sampleContext());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
      ["Assumptions", "visible"],
      ["FinancingModel", "visible"],
      ["MonthlyDebt", "visible"],
      ["CashFlowModel", "visible"],
      ["Summary", "visible"],
      ["Yield on Cost", "visible"],
      ["Formula Audit", "visible"],
      ["Model Guide", "visible"],
    ]);

    const assumptions = workbook.getWorksheet("Assumptions");
    const summary = workbook.getWorksheet("Summary");
    const financing = workbook.getWorksheet("FinancingModel");
    const monthlyDebt = workbook.getWorksheet("MonthlyDebt");
    const cashFlow = workbook.getWorksheet("CashFlowModel");
    const yieldOnCost = workbook.getWorksheet("Yield on Cost");
    const formulaAudit = workbook.getWorksheet("Formula Audit");
    const modelGuide = workbook.getWorksheet("Model Guide");

    expect(assumptions).toBeDefined();
    expect(summary).toBeDefined();
    expect(financing).toBeDefined();
    expect(monthlyDebt).toBeDefined();
    expect(cashFlow).toBeDefined();
    expect(yieldOnCost).toBeDefined();
    expect(formulaAudit).toBeDefined();
    expect(modelGuide).toBeDefined();
    expect(modelGuide?.getCell("A1").value).toBe("Workbook Formula Map");
    expect(modelGuide?.getCell("A15").value).toContain("saves the current manual underwriting draft");

    expect(assumptions?.getCell("A1").value).toBe("Deal Dossier Workbook");
    expect(assumptions?.getCell("C13").value).toBe(1_000_000);
    expect(assumptions?.getCell("C13").font?.color?.argb).toBe("FF5B9BD5");
    expect((assumptions?.getCell("C23").value as ExcelJS.CellFormulaValue).formula).toBe(
      "'Assumptions'!$C$20+'Assumptions'!$C$21+'Assumptions'!$C$22"
    );
    expect(assumptions?.getCell("C37").value).toBe(0.075);
    expect(assumptions?.getCell("C37").numFmt).toBe("0.00%;[Red](0.00%);-");
    expect(assumptions?.getCell("C37").font?.color?.argb).toBe("FF5B9BD5");
    expect(assumptions?.getCell("A58").value).toBe("Taxes");
    expect(assumptions?.getCell("B58").value).toBe(20_000);
    expect(assumptions?.getCell("C58").value).toBe(0.04);

    expect((financing?.getCell("B2").value as ExcelJS.CellFormulaValue).formula).toBe(
      "'Assumptions'!$C$13*'Assumptions'!$C$29"
    );
    expect((financing?.getCell("C13").value as ExcelJS.CellFormulaValue).formula).toBe(
      "SUMIFS(MonthlyDebt!$F$5:$F$124,MonthlyDebt!$I$5:$I$124,A13)"
    );
    expect((financing?.getCell("D13").value as ExcelJS.CellFormulaValue).formula).toBe(
      "SUMIFS(MonthlyDebt!$G$5:$G$124,MonthlyDebt!$I$5:$I$124,A13)"
    );
    expect((financing?.getCell("E13").value as ExcelJS.CellFormulaValue).formula).toBe(
      "SUMIFS(MonthlyDebt!$E$5:$E$124,MonthlyDebt!$I$5:$I$124,A13)"
    );
    expect((monthlyDebt?.getCell("C5").value as ExcelJS.CellFormulaValue).formula).toBe(
      "IF(A5>FinancingModel!$B$8,0,FinancingModel!$B$2)"
    );
    expect((monthlyDebt?.getCell("D5").value as ExcelJS.CellFormulaValue).formula).toBe("'Assumptions'!$C$30");
    expect((cashFlow?.getCell("C7").value as ExcelJS.CellFormulaValue).formula).toBe(
      "IF(OR(C$5=0,C$5>'Assumptions'!$C$51),0,C8+C9+C10)"
    );
    expect((cashFlow?.getCell("B8").value as ExcelJS.CellFormulaValue).formula).toBe(
      "'Assumptions'!$C$37"
    );
    expect((cashFlow?.getCell("D17").value as ExcelJS.CellFormulaValue).formula).toBe(
      "IF(OR(D$5=0,D$5>'Assumptions'!$C$51),0,-('Assumptions'!$B$58)*((1+'Assumptions'!$C$58)^(D$5-1)))"
    );
    expect((cashFlow?.getCell("D17").value as ExcelJS.CellFormulaValue).result).toBe(-20_800);
    expect(cashFlow?.getCell("D17").fill?.fgColor?.argb).toBe("FFFFFFFF");
    const totalInvestmentCostRow = findRowByLabel(cashFlow, "Total investment cost");
    const totalLeveredCashFlowRow = findRowByLabel(cashFlow, "Total levered CF incl. exit");
    const noiRow = findRowByLabel(cashFlow, "Net operating income (NOI)");
    const debtServiceRow = findRowByLabel(cashFlow, "Total debt service");
    expect(totalInvestmentCostRow).not.toBeNull();
    expect(totalLeveredCashFlowRow).not.toBeNull();
    expect(noiRow).not.toBeNull();
    expect(debtServiceRow).not.toBeNull();
    expect(
      (
        cashFlow?.getCell(`C${totalLeveredCashFlowRow!}`).value as ExcelJS.CellFormulaValue
      ).formula
    ).toContain(`C${totalInvestmentCostRow!}`);

    expect(summary?.views?.[0]?.showGridLines).toBe(false);
    expect(summary?.getCell("B20").numFmt).toBe("0.00%;[Red](0.00%);-");
    expect((summary?.getCell("C5").value as ExcelJS.CellFormulaValue).formula).toBe("'Assumptions'!$C$5");
    expect((summary?.getCell("C20").value as ExcelJS.CellFormulaValue).formula).toBe("CashFlowModel!C6");
    expect((summary?.getCell("H13").value as ExcelJS.CellFormulaValue).formula).toBe(
      "CashFlowModel!$B$49"
    );
    expect((summary?.getCell("C12").value as ExcelJS.CellFormulaValue).formula).toBe(
      "IF('Assumptions'!$C$13=0,\"\",'Assumptions'!$C$26/'Assumptions'!$C$13)"
    );
    expect((summary?.getCell("H14").value as ExcelJS.CellFormulaValue).formula).toContain(
      "-'Assumptions'!$C$26)/'Assumptions'!$C$13"
    );
    const calculatedAverageCashOnCashRow = findRowByLabel(cashFlow, "Calculated average cash-on-cash");
    expect(calculatedAverageCashOnCashRow).not.toBeNull();
    expect(
      (
        cashFlow?.getCell(`B${calculatedAverageCashOnCashRow!}`).value as ExcelJS.CellFormulaValue
      ).formula
    ).toBe(
      `IF(OR(FinancingModel!$B$6=0,'Assumptions'!$C$51=0),0,(SUM($D$${noiRow!}:INDEX($D$${noiRow!}:$M$${noiRow!},1,'Assumptions'!$C$51))+SUM($D$${debtServiceRow!}:INDEX($D$${debtServiceRow!}:$M$${debtServiceRow!},1,'Assumptions'!$C$51)))/('Assumptions'!$C$51*FinancingModel!$B$6))`
    );
    expect((yieldOnCost?.getCell("B12").value as ExcelJS.CellFormulaValue).formula).toBe("IF(B9=0,0,E4/B9)");
    expect((yieldOnCost?.getCell("B13").value as ExcelJS.CellFormulaValue).formula).toBe("IF(B9=0,0,E5/B9)");
    expect(formulaAudit?.getCell("A1").value).toBe("Formula Audit");
    expect(formulaAudit?.getCell("A6").value).toBe("Hardcoded expense constants moved to Assumptions");
    expect(workbookFormulas(workbook).some((formula) => /OFFSET|INDIRECT/.test(formula))).toBe(false);
  });

  it("caches current NOI from the workbook formula basis instead of the raw ctx.currentNoi", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const ctx = sampleContext();
    ctx.currentNoi = 70_000;

    const { buffer } = await buildDealAnalysisWorkbook(ctx);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const summary = workbook.getWorksheet("Summary");
    const assumptions = workbook.getWorksheet("Assumptions");

    expect((summary?.getCell("C11").value as ExcelJS.CellFormulaValue).formula).toBe("'Assumptions'!$C$26");
    expect((summary?.getCell("C11").value as ExcelJS.CellFormulaValue).result).toBe(80_000);
    expect((assumptions?.getCell("C26").value as ExcelJS.CellFormulaValue).result).toBe(80_000);
  });
});
