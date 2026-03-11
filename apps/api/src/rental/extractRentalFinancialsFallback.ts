import type {
  ExpenseLineItem,
  OmAnalysis,
  OmRentRollRow,
  RentalFinancialsFromLlm,
  RentalNumberPerUnit,
} from "@re-sourcing/contracts";

const COMMERCIAL_PATTERN =
  /\b(commercial|retail|office|storefront|store front|restaurant|cafe|gallery|medical|community facility|store)\b/i;
const RENT_STABILIZED_PATTERN = /(rent[\s-]*(?:stabilized|stabilised|controlled?)|\bRS\b)/i;
const STREET_TYPE_PATTERN =
  "(?:street|st|avenue|ave|road|rd|boulevard|blvd|place|pl|lane|ln|drive|dr|court|ct|way|terrace|ter|parkway|pkwy|broadway)";

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function linesFromText(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function nextLineAfter(lines: string[], pattern: RegExp): string | null {
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return null;
  return lines[index + 1] ?? null;
}

function matchMoneyAfterLabel(text: string, labelPattern: RegExp): number | null {
  const match = text.match(new RegExp(`${labelPattern.source}[\\s:]*\\$?([\\d,]+)`, "i"));
  return toNumber(match?.[1]);
}

function matchMoneyBeforeLabel(text: string, labelPattern: RegExp): number | null {
  const match = text.match(new RegExp(`\\$?([\\d,]+)[\\s:]*${labelPattern.source}`, "i"));
  return toNumber(match?.[1]);
}

function matchNearestMoneyBeforeLabel(text: string, labelPattern: RegExp): number | null {
  const match = text.match(new RegExp(`([\\s\\S]{0,60})${labelPattern.source}`, "i"));
  if (!match?.[1]) return null;
  const amounts = Array.from(match[1].matchAll(/\$([\d,]+)/g))
    .map((entry) => toNumber(entry[1]))
    .filter((value): value is number => value != null);
  return amounts.length > 0 ? amounts[amounts.length - 1] : null;
}

function inferNeighborhood(lines: string[], text: string): string | null {
  const direct = nextLineAfter(lines, /^PRICE\s+NEIGHBORHOOD$/i);
  if (direct) return direct;
  if (/greenwich village/i.test(text)) return "Greenwich Village";
  if (/west village/i.test(text)) return "West Village";
  if (/east village/i.test(text)) return "East Village";
  return null;
}

function inferAddress(text: string): string | null {
  const narrativeMatch = text.match(
    new RegExp(
      `\\b(\\d+(?:\\s*[-–—]\\s*\\d+)?\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,5}\\s+${STREET_TYPE_PATTERN})\\b(?=\\s+(?:has|is|are|consists|contains|sits|lies)\\b)`,
      "i"
    )
  );
  if (narrativeMatch?.[1]) return collapseSpaces(narrativeMatch[1]);

  const genericMatch = text.match(
    new RegExp(
      `\\b(\\d+(?:\\s*[-–—]\\s*\\d+)?\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,5}\\s+${STREET_TYPE_PATTERN})\\b`,
      "i"
    )
  );
  return genericMatch?.[1] ? collapseSpaces(genericMatch[1]) : null;
}

function inferBlockAndLots(text: string): { block: number | null; lotNumbers: number[] } {
  const match = text.match(/Block\s+(\d+),\s*Lots?\s+([0-9,\sand]+)/i);
  if (!match) return { block: null, lotNumbers: [] };
  const block = toNumber(match[1]);
  const lotNumbers = Array.from((match[2] ?? "").matchAll(/\d+/g))
    .map((entry) => Number(entry[0]))
    .filter((value) => Number.isFinite(value));
  return {
    block,
    lotNumbers,
  };
}

function inferPropertyType(text: string, commercialUnits: number): string | null {
  if (/townhouse/i.test(text)) return "Townhouse";
  if (commercialUnits > 0) return "Mixed-use";
  if (/multifamily/i.test(text)) return "Multifamily";
  return null;
}

function parseResidentialCommercialCounts(text: string): {
  residentialUnits: number | null;
  commercialUnits: number | null;
  totalUnitsNarrative: number | null;
} {
  const direct = text.match(/(\d+)\s+Total Residential\s+units?\s+and\s+(\d+)\s+Commercial Units?/i);
  if (direct) {
    const residentialUnits = toNumber(direct[1]);
    const commercialUnits = toNumber(direct[2]);
    return {
      residentialUnits,
      commercialUnits,
      totalUnitsNarrative:
        residentialUnits != null && commercialUnits != null ? residentialUnits + commercialUnits : null,
    };
  }
  return { residentialUnits: null, commercialUnits: null, totalUnitsNarrative: null };
}

function parseCombinedUnitsAndSqft(lines: string[]): { totalUnitsMetric: number | null; buildingSqft: number | null } {
  for (let index = 1; index < lines.length - 1; index += 1) {
    if (!/TOTAL UNITS/i.test(lines[index]) || !/TOTAL SQUARE FEET/i.test(lines[index + 1])) continue;
    const prior = lines[index - 1].replace(/[^\d,]/g, "");
    const direct = toNumber(prior);
    if (direct != null && !prior.includes(",")) {
      return { totalUnitsMetric: direct, buildingSqft: null };
    }
    const split = prior.match(/^(\d{1,2})(\d{1,3},\d{3})$/);
    if (split) {
      return {
        totalUnitsMetric: toNumber(split[1]),
        buildingSqft: toNumber(split[2]),
      };
    }
  }
  return { totalUnitsMetric: null, buildingSqft: null };
}

function parseRentRoll(lines: string[]): {
  rentRoll: OmRentRollRow[];
  totalIncome: number | null;
  totalIncomeMonthly: number | null;
} {
  const rentRoll: OmRentRollRow[] = [];
  let totalIncome: number | null = null;
  let totalIncomeMonthly: number | null = null;

  const rowPattern = /^(.+?)\s*\$([\d,]+)\s*\$([\d,]+)$/;
  for (const line of lines) {
    const match = line.match(rowPattern);
    if (!match) continue;
    const label = match[1].trim();
    const monthly = toNumber(match[2]);
    const annual = toNumber(match[3]);
    if (monthly == null || annual == null) continue;
    if (/^Total Income$/i.test(label)) {
      totalIncomeMonthly = monthly;
      totalIncome = annual;
      continue;
    }
    if (/tax bill|property taxes|annual tax/i.test(label)) continue;
    if (/annual rent|monthly rent/i.test(label)) continue;
    if (label.length > 80) continue;
    const notes = RENT_STABILIZED_PATTERN.test(label) ? "Rent Stabilized" : undefined;
    rentRoll.push({
      unit: label,
      unitCategory: COMMERCIAL_PATTERN.test(label) ? "Commercial" : "Residential",
      monthlyRent: monthly,
      annualRent: annual,
      notes,
      rentType: notes ?? undefined,
    });
  }

  return { rentRoll, totalIncome, totalIncomeMonthly };
}

function parseExpenseSection(lines: string[]): { expensesTable: ExpenseLineItem[]; totalExpenses: number | null } {
  const startIndex = lines.findIndex((line) => /^Estimated Expenses$/i.test(line));
  if (startIndex < 0) return { expensesTable: [], totalExpenses: null };

  const expensesTable: ExpenseLineItem[] = [];
  let totalExpenses: number | null = null;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^NOI$/i.test(line) || /Net Operating Income/i.test(line) || /CURRENT FLOORPLAN/i.test(line)) break;
    if (/Estimated cost/i.test(line)) continue;
    const totalMatch = line.match(/^Total Expenses\s*\$([\d,]+)$/i);
    if (totalMatch) {
      totalExpenses = toNumber(totalMatch[1]);
      continue;
    }
    const match = line.match(/^(.+?)\s*\$([\d,]+)$/);
    if (!match) continue;
    const lineItem = match[1].trim();
    const amount = toNumber(match[2]);
    if (!amount || /annual tax bill/i.test(lineItem)) continue;
    expensesTable.push({ lineItem, amount });
  }
  return {
    expensesTable,
    totalExpenses: totalExpenses ?? (expensesTable.length > 0 ? expensesTable.reduce((sum, row) => sum + row.amount, 0) : null),
  };
}

function parseNoi(text: string): number | null {
  return (
    matchMoneyAfterLabel(text, /Net Operating Income/i) ??
    matchMoneyAfterLabel(text, /\bNOI\b/i)
  );
}

function inferAnnualTaxes(text: string): number | null {
  const direct =
    matchMoneyAfterLabel(text, /PROPERTY TAXES/i) ??
    matchMoneyBeforeLabel(text, /PROPERTY TAXES/i) ??
    matchNearestMoneyBeforeLabel(text, /PROPERTY TAXES/i);
  if (direct != null) return direct;

  const matches = Array.from(text.matchAll(/Annual Tax Bill((?:\s*\$[\d,]+)+)/gi))
    .flatMap((match) =>
      Array.from((match[1] ?? "").matchAll(/\$([\d,]+)/g))
        .map((entry) => toNumber(entry[1]))
        .filter((value): value is number => value != null)
    );
  if (matches.length > 0) return matches.reduce((sum, value) => sum + value, 0);
  return null;
}

function inferPrice(text: string): number | null {
  return (
    matchMoneyAfterLabel(text, /AVAILABLE FOR SALE/i) ??
    matchMoneyAfterLabel(text, /is being offered at/i) ??
    matchMoneyAfterLabel(text, /\bPRICE\b/i)
  );
}

function inferBuildingSqft(text: string, lines: string[]): number | null {
  const direct =
    toNumber(text.match(/approximately[^.\n]{0,40}?(\d[\d,]*)\s+square\s+feet/i)?.[1]) ??
    toNumber(text.match(/Approximate Building SF\s*(\d[\d,]*)/i)?.[1]);
  if (direct != null) return direct;
  return parseCombinedUnitsAndSqft(lines).buildingSqft;
}

function inferTaxClass(text: string): string | null {
  const direct = text.match(/Tax Class\s*([A-Za-z0-9]+)/i)?.[1] ?? text.match(/\b(2A|2B|2C|2D|4)\b\s*TAX CLASS/i)?.[1];
  return direct ? direct.trim() : null;
}

function inferFreeMarketPct(text: string): number | null {
  return toNumber(text.match(/(\d{1,3})%\s*FREE MARKET/i)?.[1]);
}

function inferCurrentGrossRent(rentRoll: OmRentRollRow[], totalIncome: number | null): number | null {
  if (totalIncome != null) return totalIncome;
  const summed = rentRoll.reduce((sum, row) => sum + (row.annualRent ?? row.annualTotalRent ?? 0), 0);
  return summed > 0 ? summed : null;
}

function inferRevenueComposition(input: {
  rentRoll: OmRentRollRow[];
  residentialUnits: number | null;
  commercialUnits: number | null;
  freeMarketPct: number | null;
}): Record<string, unknown> | null {
  const residentialAnnualRent = input.rentRoll
    .filter((row) => !COMMERCIAL_PATTERN.test([row.unitCategory, row.unit, row.tenantName, row.notes].filter(Boolean).join(" ")))
    .reduce((sum, row) => sum + (row.annualRent ?? row.annualTotalRent ?? 0), 0);
  const commercialAnnualRent = input.rentRoll
    .filter((row) => COMMERCIAL_PATTERN.test([row.unitCategory, row.unit, row.tenantName, row.notes].filter(Boolean).join(" ")))
    .reduce((sum, row) => sum + (row.annualRent ?? row.annualTotalRent ?? 0), 0);
  const rentStabilizedUnits = input.rentRoll.filter((row) =>
    RENT_STABILIZED_PATTERN.test([row.notes, row.rentType, row.unit].filter(Boolean).join(" "))
  ).length;

  let freeMarketUnits: number | null =
    input.residentialUnits != null && input.freeMarketPct != null
      ? Math.round(input.residentialUnits * (input.freeMarketPct / 100))
      : null;
  if (freeMarketUnits == null && input.residentialUnits != null) {
    freeMarketUnits = Math.max(0, input.residentialUnits - rentStabilizedUnits);
  }
  const inferredRentStabilizedUnits =
    input.residentialUnits != null && freeMarketUnits != null
      ? Math.max(0, input.residentialUnits - freeMarketUnits)
      : rentStabilizedUnits;

  const output: Record<string, unknown> = {};
  if (residentialAnnualRent > 0) {
    output.residentialAnnualRent = residentialAnnualRent;
    output.residentialMonthlyRent = residentialAnnualRent / 12;
  }
  if (commercialAnnualRent > 0) {
    output.commercialAnnualRent = commercialAnnualRent;
    output.commercialMonthlyRent = commercialAnnualRent / 12;
  }
  if (input.commercialUnits != null) output.commercialUnits = input.commercialUnits;
  if (freeMarketUnits != null) output.freeMarketUnits = freeMarketUnits;
  if (inferredRentStabilizedUnits > 0) output.rentStabilizedUnits = inferredRentStabilizedUnits;
  if (commercialAnnualRent > 0 || residentialAnnualRent > 0) {
    const total = residentialAnnualRent + commercialAnnualRent;
    output.commercialRevenueShare = total > 0 ? commercialAnnualRent / total : 0;
  }
  return Object.keys(output).length > 0 ? output : null;
}

function buildInvestmentTakeaways(input: {
  price: number | null;
  noi: number | null;
  totalUnits: number | null;
  residentialUnits: number | null;
  commercialUnits: number | null;
  taxClass: string | null;
  rentRollCount: number;
  rentStabilizedUnits: number;
  freeMarketPct: number | null;
}): string[] {
  const takeaways: string[] = [];
  if (input.taxClass && /^2A$/i.test(input.taxClass)) {
    takeaways.push("Protected Tax Class 2A supports slower real estate tax growth.");
  }
  if (input.commercialUnits != null && input.commercialUnits > 0) {
    takeaways.push(`${input.commercialUnits} commercial unit(s) require separate underwriting from residential upside.`);
  }
  if (input.rentStabilizedUnits > 0) {
    takeaways.push(`${input.rentStabilizedUnits} rent-stabilized unit(s) limit achievable residential rent uplift.`);
  } else if (
    input.residentialUnits != null &&
    input.freeMarketPct != null &&
    input.freeMarketPct < 100
  ) {
    const inferredProtected = Math.max(0, Math.round(input.residentialUnits * (1 - input.freeMarketPct / 100)));
    if (inferredProtected > 0) {
      takeaways.push(
        `${input.freeMarketPct.toFixed(0)}% free-market mix implies roughly ${inferredProtected} protected residential unit(s).`
      );
    }
  }
  if (input.totalUnits != null && input.rentRollCount > 0 && input.rentRollCount < input.totalUnits) {
    takeaways.push(`Rent roll may be incomplete; extracted ${input.rentRollCount} of ${input.totalUnits} stated units from plain PDF text.`);
  }
  if (input.noi == null) {
    takeaways.push("NOI was not recoverable from plain-text extraction; image-based financial pages may need multimodal parsing.");
  }
  if (takeaways.length === 0 && input.price != null) {
    takeaways.push("Plain-text OM extraction recovered only core pricing and property facts.");
  }
  return takeaways.slice(0, 5);
}

function fromLlmFromOmAnalysis(om: OmAnalysis): RentalFinancialsFromLlm {
  const income = om.income as Record<string, unknown> | undefined;
  const valuation = om.valuationMetrics as Record<string, unknown> | undefined;
  const ui = om.uiFinancialSummary as Record<string, unknown> | undefined;
  const expenses = om.expenses as { totalExpenses?: number; expensesTable?: ExpenseLineItem[] } | undefined;
  const noi =
    om.noiReported ??
    (income?.NOI as number | undefined) ??
    (valuation?.NOI as number | undefined) ??
    (ui?.noi as number | undefined);
  const capRate =
    (valuation?.capRate as number | undefined) ??
    (ui?.capRate as number | undefined);
  const grossRentTotal =
    (income?.grossRentActual as number | undefined) ??
    (income?.grossRentPotential as number | undefined) ??
    (ui?.grossRent as number | undefined);

  const rentalNumbersPerUnit: RentalNumberPerUnit[] =
    om.rentRoll?.map((row) => {
      const monthlyRent =
        typeof row.monthlyRent === "number"
          ? row.monthlyRent
          : typeof row.monthlyTotalRent === "number"
            ? row.monthlyTotalRent
            : typeof row.monthlyBaseRent === "number"
              ? row.monthlyBaseRent
              : undefined;
      const annualRent =
        typeof row.annualRent === "number"
          ? row.annualRent
          : typeof row.annualTotalRent === "number"
            ? row.annualTotalRent
            : typeof row.annualBaseRent === "number"
              ? row.annualBaseRent
              : monthlyRent != null
                ? monthlyRent * 12
                : undefined;
      return {
        unit: row.unit,
        monthlyRent,
        annualRent,
        beds: row.beds,
        baths: row.baths,
        sqft: row.sqft,
        occupied: row.occupied,
        lastRentedDate: row.lastRentedDate,
        dateVacant: row.dateVacant,
        note: [row.rentType, row.notes, row.unitCategory].filter(Boolean).join("; ") || undefined,
      };
    }) ?? [];

  const output: RentalFinancialsFromLlm = {};
  if (noi != null) output.noi = noi;
  if (capRate != null) output.capRate = capRate;
  if (grossRentTotal != null) output.grossRentTotal = grossRentTotal;
  if (expenses?.totalExpenses != null) output.totalExpenses = expenses.totalExpenses;
  if (expenses?.expensesTable?.length) output.expensesTable = expenses.expensesTable;
  if (rentalNumbersPerUnit.length > 0) output.rentalNumbersPerUnit = rentalNumbersPerUnit;
  if (Array.isArray(om.investmentTakeaways) && om.investmentTakeaways.length > 0) {
    output.keyTakeaways = om.investmentTakeaways.map((line) => (line.startsWith("•") ? line : `• ${line}`)).join("\n");
  }
  return output;
}

export function extractRentalFinancialsFallback(text: string): {
  fromLlm: RentalFinancialsFromLlm | null;
  omAnalysis: OmAnalysis | null;
} {
  const trimmed = text.trim();
  if (!trimmed) return { fromLlm: null, omAnalysis: null };

  const lines = linesFromText(trimmed);
  const { residentialUnits, commercialUnits, totalUnitsNarrative } = parseResidentialCommercialCounts(trimmed);
  const { totalUnitsMetric, buildingSqft: combinedSqft } = parseCombinedUnitsAndSqft(lines);
  const { rentRoll, totalIncome, totalIncomeMonthly } = parseRentRoll(lines);
  const { expensesTable, totalExpenses } = parseExpenseSection(lines);
  const price = inferPrice(trimmed);
  const annualTaxes = inferAnnualTaxes(trimmed);
  const noi = parseNoi(trimmed);
  const taxClass = inferTaxClass(trimmed);
  const buildingSqft = inferBuildingSqft(trimmed, lines) ?? combinedSqft;
  const freeMarketPct = inferFreeMarketPct(trimmed);
  const currentGrossRent = inferCurrentGrossRent(rentRoll, totalIncome);
  const neighborhood = inferNeighborhood(lines, trimmed);
  const address = inferAddress(trimmed);
  const { block, lotNumbers } = inferBlockAndLots(trimmed);
  const totalUnits =
    totalUnitsNarrative ??
    (rentRoll.length > 0 ? rentRoll.length : null) ??
    totalUnitsMetric;

  const revenueComposition = inferRevenueComposition({
    rentRoll,
    residentialUnits,
    commercialUnits,
    freeMarketPct,
  });
  const rentStabilizedUnits =
    typeof revenueComposition?.rentStabilizedUnits === "number" ? (revenueComposition.rentStabilizedUnits as number) : 0;

  const capRate = price != null && noi != null && price > 0 ? (noi / price) * 100 : null;
  const expenseRatio =
    currentGrossRent != null && totalExpenses != null && currentGrossRent > 0 ? totalExpenses / currentGrossRent : null;
  const pricePerUnit = price != null && totalUnits != null && totalUnits > 0 ? price / totalUnits : null;
  const pricePerSqft = price != null && buildingSqft != null && buildingSqft > 0 ? price / buildingSqft : null;

  const reportedDiscrepancies: Array<Record<string, unknown>> = [];
  if (totalUnits != null && rentRoll.length > 0 && rentRoll.length !== totalUnits) {
    reportedDiscrepancies.push({
      field: "totalUnits",
      reportedValues: [`Rent roll extracted ${rentRoll.length}`, `OM states ${totalUnits}`],
      selectedValue: totalUnits,
    });
  }
  if (totalUnitsNarrative != null && totalUnitsMetric != null && totalUnitsNarrative !== totalUnitsMetric) {
    reportedDiscrepancies.push({
      field: "totalUnits",
      reportedValues: [`Narrative ${totalUnitsNarrative}`, `Listing metric ${totalUnitsMetric}`],
      selectedValue: totalUnitsNarrative,
    });
  }

  const propertyInfo: Record<string, unknown> = {};
  if (price != null) propertyInfo.price = price;
  if (address) propertyInfo.address = address;
  if (neighborhood) propertyInfo.neighborhood = neighborhood;
  if (taxClass) propertyInfo.taxClass = taxClass;
  if (annualTaxes != null) propertyInfo.annualTaxes = annualTaxes;
  if (buildingSqft != null) propertyInfo.buildingSqft = buildingSqft;
  if (residentialUnits != null) propertyInfo.unitsResidential = residentialUnits;
  if (commercialUnits != null) propertyInfo.unitsCommercial = commercialUnits;
  if (totalUnits != null) propertyInfo.totalUnits = totalUnits;
  if (block != null) propertyInfo.block = block;
  if (lotNumbers.length > 0) propertyInfo.lotNumbers = lotNumbers;
  const propertyType = inferPropertyType(trimmed, commercialUnits ?? 0);
  if (propertyType) propertyInfo.propertyType = propertyType;
  if (/manhattan/i.test(trimmed)) propertyInfo.borough = "Manhattan";

  const income: Record<string, unknown> = {};
  if (currentGrossRent != null) {
    income.grossRentActual = currentGrossRent;
    income.grossRentPotential = currentGrossRent;
    income.effectiveGrossIncome = currentGrossRent;
  }
  if (totalIncomeMonthly != null) income.grossRentActualMonthly = totalIncomeMonthly;
  if (noi != null) income.NOI = noi;

  const valuationMetrics: Record<string, unknown> = {};
  if (capRate != null) valuationMetrics.capRate = capRate;
  if (noi != null) valuationMetrics.NOI = noi;

  const uiFinancialSummary: Record<string, unknown> = {};
  if (price != null) uiFinancialSummary.price = price;
  if (pricePerUnit != null) uiFinancialSummary.pricePerUnit = pricePerUnit;
  if (pricePerSqft != null) uiFinancialSummary.pricePerSqft = pricePerSqft;
  if (currentGrossRent != null) uiFinancialSummary.grossRent = currentGrossRent;
  if (noi != null) uiFinancialSummary.noi = noi;
  if (capRate != null) uiFinancialSummary.capRate = capRate;
  if (expenseRatio != null) uiFinancialSummary.expenseRatio = expenseRatio;

  const investmentTakeaways = buildInvestmentTakeaways({
    price,
    noi,
    totalUnits,
    residentialUnits,
    commercialUnits,
    taxClass,
    rentRollCount: rentRoll.length,
    rentStabilizedUnits,
    freeMarketPct,
  });

  if (
    Object.keys(propertyInfo).length === 0 &&
    rentRoll.length === 0 &&
    expensesTable.length === 0 &&
    currentGrossRent == null &&
    noi == null
  ) {
    return { fromLlm: null, omAnalysis: null };
  }

  const omAnalysis: OmAnalysis = {
    propertyInfo: Object.keys(propertyInfo).length > 0 ? propertyInfo : undefined,
    rentRoll: rentRoll.length > 0 ? rentRoll : undefined,
    income: Object.keys(income).length > 0 ? income : undefined,
    expenses:
      expensesTable.length > 0 || totalExpenses != null
        ? {
            expensesTable: expensesTable.length > 0 ? expensesTable : undefined,
            totalExpenses: totalExpenses ?? undefined,
          }
        : undefined,
    revenueComposition: revenueComposition ?? undefined,
    valuationMetrics: Object.keys(valuationMetrics).length > 0 ? valuationMetrics : undefined,
    investmentTakeaways: investmentTakeaways.length > 0 ? investmentTakeaways : undefined,
    reportedDiscrepancies: reportedDiscrepancies.length > 0 ? reportedDiscrepancies : undefined,
    sourceCoverage: {
      mode: "deterministic_fallback",
      extractedTextOnly: true,
      rentRollExtracted: rentRoll.length > 0,
      expensesExtracted: expensesTable.length > 0,
      currentFinancialsExtracted: currentGrossRent != null || noi != null,
    },
    uiFinancialSummary: Object.keys(uiFinancialSummary).length > 0 ? uiFinancialSummary : undefined,
    noiReported: noi ?? undefined,
  };

  return {
    fromLlm: fromLlmFromOmAnalysis(omAnalysis),
    omAnalysis,
  };
}
