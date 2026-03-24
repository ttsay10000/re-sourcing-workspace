import OpenAI from "openai";
import type {
  ExpenseLineItem,
  OmAuthoritativeCurrentFinancials,
  OmAuthoritativeSnapshot,
  OmRentRollRow,
  PropertyDetails,
} from "@re-sourcing/contracts";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";
import { getAuthoritativeOmSnapshot } from "../om/authoritativeOm.js";
import {
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
} from "../rental/omAnalysisUtils.js";

export interface BrokerDossierNotesExtract {
  propertyInfo?: Record<string, unknown> | null;
  rentRoll?: OmRentRollRow[] | null;
  expenses?: { expensesTable?: ExpenseLineItem[] | null; totalExpenses?: number | null } | null;
  currentFinancials?: OmAuthoritativeCurrentFinancials | null;
  notesSummary?: string | null;
  investmentTakeaways?: string[] | null;
}

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  return key.length >= 10 ? key : null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content || typeof content !== "string") return null;
  let jsonStr = content.trim();
  const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  return JSON.parse(jsonStr) as Record<string, unknown>;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function annualRentFromRow(row: Record<string, unknown>): number | null {
  const annual =
    toFiniteNumber(row.annualTotalRent) ??
    toFiniteNumber(row.annualBaseRent) ??
    toFiniteNumber(row.annualRent);
  if (annual != null) return annual;

  const monthly =
    toFiniteNumber(row.monthlyTotalRent) ??
    toFiniteNumber(row.monthlyBaseRent) ??
    toFiniteNumber(row.monthlyRent);
  return monthly != null ? monthly * 12 : null;
}

function sumAnnualRent(rows: OmRentRollRow[] | null | undefined): number | null {
  const cleanRows = sanitizeOmRentRollRows(rows ?? []);
  const total = cleanRows.reduce((sum, row) => {
    const annual = annualRentFromRow(row as Record<string, unknown>);
    return annual != null && annual > 0 ? sum + annual : sum;
  }, 0);
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

function sumExpenses(rows: ExpenseLineItem[] | null | undefined): number | null {
  const cleanRows = sanitizeExpenseTableRows(rows ?? []);
  const total = cleanRows.reduce((sum, row) => sum + row.amount, 0);
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

function sanitizeTakeaways(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const takeaways = value
    .map((entry) => trimmedString(entry))
    .filter((entry): entry is string => entry != null);
  return takeaways.length > 0 ? takeaways.slice(0, 5) : null;
}

function sanitizeRentRoll(value: unknown): OmRentRollRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value
    .map((entry): OmRentRollRow | null => {
      const row = asRecord(entry);
      if (!row) return null;
      const occupiedValue = row.occupied;
      return {
        unit: trimmedString(row.unit) ?? undefined,
        building: trimmedString(row.building) ?? undefined,
        unitCategory: trimmedString(row.unitCategory) ?? undefined,
        tenantName: trimmedString(row.tenantName) ?? undefined,
        monthlyRent: toFiniteNumber(row.monthlyRent) ?? undefined,
        monthlyBaseRent: toFiniteNumber(row.monthlyBaseRent) ?? undefined,
        monthlyTotalRent: toFiniteNumber(row.monthlyTotalRent) ?? undefined,
        annualRent: toFiniteNumber(row.annualRent) ?? undefined,
        annualBaseRent: toFiniteNumber(row.annualBaseRent) ?? undefined,
        annualTotalRent: toFiniteNumber(row.annualTotalRent) ?? undefined,
        beds: toFiniteNumber(row.beds) ?? undefined,
        baths: toFiniteNumber(row.baths) ?? undefined,
        sqft: toFiniteNumber(row.sqft) ?? undefined,
        rentType: trimmedString(row.rentType) ?? undefined,
        tenantStatus: trimmedString(row.tenantStatus) ?? undefined,
        leaseType: trimmedString(row.leaseType) ?? undefined,
        leaseStartDate: trimmedString(row.leaseStartDate) ?? undefined,
        leaseEndDate: trimmedString(row.leaseEndDate) ?? undefined,
        reimbursementType: trimmedString(row.reimbursementType) ?? undefined,
        reimbursementAmount: toFiniteNumber(row.reimbursementAmount) ?? undefined,
        rentEscalations: trimmedString(row.rentEscalations) ?? undefined,
        occupied:
          typeof occupiedValue === "boolean"
            ? occupiedValue
            : trimmedString(occupiedValue) ?? undefined,
        lastRentedDate: trimmedString(row.lastRentedDate) ?? undefined,
        dateVacant: trimmedString(row.dateVacant) ?? undefined,
        notes: trimmedString(row.notes) ?? undefined,
        projectedMonthlyRentLow: toFiniteNumber(row.projectedMonthlyRentLow) ?? undefined,
        projectedMonthlyRentHigh: toFiniteNumber(row.projectedMonthlyRentHigh) ?? undefined,
        projectedAnnualRentLow: toFiniteNumber(row.projectedAnnualRentLow) ?? undefined,
        projectedAnnualRentHigh: toFiniteNumber(row.projectedAnnualRentHigh) ?? undefined,
      } satisfies OmRentRollRow;
    })
    .filter((row): row is OmRentRollRow => row != null);
  const cleanRows = sanitizeOmRentRollRows(rows);
  return cleanRows.length > 0 ? cleanRows : null;
}

function sanitizeExpenses(value: unknown): BrokerDossierNotesExtract["expenses"] {
  const record = asRecord(value);
  if (!record) return null;
  const expensesTable = sanitizeExpenseTableRows(record.expensesTable as ExpenseLineItem[] | undefined);
  const totalExpenses = firstFiniteNumber(record.totalExpenses, sumExpenses(expensesTable));
  if (expensesTable.length === 0 && totalExpenses == null) return null;
  return {
    expensesTable: expensesTable.length > 0 ? expensesTable : null,
    totalExpenses,
  };
}

function sanitizeCurrentFinancials(value: unknown): OmAuthoritativeCurrentFinancials | null {
  const record = asRecord(value);
  if (!record) return null;
  const currentFinancials: OmAuthoritativeCurrentFinancials = {
    grossRentalIncome: toFiniteNumber(record.grossRentalIncome),
    otherIncome: toFiniteNumber(record.otherIncome),
    operatingExpenses: toFiniteNumber(record.operatingExpenses),
    noi: toFiniteNumber(record.noi),
    vacancyLoss: toFiniteNumber(record.vacancyLoss),
    effectiveGrossIncome: toFiniteNumber(record.effectiveGrossIncome),
  };
  const hasValue = Object.values(currentFinancials).some((entry) => entry != null);
  return hasValue ? currentFinancials : null;
}

function mergedPropertyInfo(
  basePropertyInfo: Record<string, unknown> | null,
  notePropertyInfo: Record<string, unknown> | null,
  rentRoll: OmRentRollRow[] | null
): Record<string, unknown> | null {
  const merged = {
    ...(basePropertyInfo ?? {}),
    ...(notePropertyInfo ?? {}),
  };
  const derivedTotalUnits =
    firstFiniteNumber(notePropertyInfo?.totalUnits, notePropertyInfo?.unitsTotal) ??
    (rentRoll != null && rentRoll.length > 0 ? rentRoll.length : null) ??
    firstFiniteNumber(basePropertyInfo?.totalUnits, basePropertyInfo?.unitsTotal);
  if (derivedTotalUnits != null) merged.totalUnits = Math.round(derivedTotalUnits);
  return Object.keys(merged).length > 0 ? merged : null;
}

function mergedCurrentFinancials(
  baseCurrentFinancials: OmAuthoritativeCurrentFinancials | null | undefined,
  noteCurrentFinancials: OmAuthoritativeCurrentFinancials | null | undefined,
  rentRoll: OmRentRollRow[] | null,
  expenses: { totalExpenses?: number | null } | null
): OmAuthoritativeCurrentFinancials | null {
  const grossRentalIncome = firstFiniteNumber(
    noteCurrentFinancials?.grossRentalIncome,
    sumAnnualRent(rentRoll),
    baseCurrentFinancials?.grossRentalIncome
  );
  const otherIncome = firstFiniteNumber(
    noteCurrentFinancials?.otherIncome,
    baseCurrentFinancials?.otherIncome
  );
  const operatingExpenses = firstFiniteNumber(
    noteCurrentFinancials?.operatingExpenses,
    expenses?.totalExpenses,
    baseCurrentFinancials?.operatingExpenses
  );
  const vacancyLoss = firstFiniteNumber(
    noteCurrentFinancials?.vacancyLoss,
    baseCurrentFinancials?.vacancyLoss
  );
  const noi = firstFiniteNumber(
    noteCurrentFinancials?.noi,
    grossRentalIncome != null && operatingExpenses != null
      ? grossRentalIncome + (otherIncome ?? 0) - operatingExpenses
      : null,
    baseCurrentFinancials?.noi
  );
  const effectiveGrossIncome = firstFiniteNumber(
    noteCurrentFinancials?.effectiveGrossIncome,
    grossRentalIncome != null
      ? grossRentalIncome + (otherIncome ?? 0) - (vacancyLoss ?? 0)
      : null,
    baseCurrentFinancials?.effectiveGrossIncome
  );

  const currentFinancials: OmAuthoritativeCurrentFinancials = {
    grossRentalIncome,
    otherIncome,
    operatingExpenses,
    noi,
    vacancyLoss,
    effectiveGrossIncome,
  };
  const hasValue = Object.values(currentFinancials).some((entry) => entry != null);
  return hasValue ? currentFinancials : null;
}

export function getBrokerEmailNotes(
  details: PropertyDetails | null | undefined
): string | null {
  return trimmedString(details?.dealDossier?.assumptions?.brokerEmailNotes);
}

export function hasBrokerEmailNotes(
  details: PropertyDetails | null | undefined
): boolean {
  return getBrokerEmailNotes(details) != null;
}

export async function extractBrokerDossierNotes(
  notesText: string | null | undefined
): Promise<BrokerDossierNotesExtract | null> {
  const notes = trimmedString(notesText);
  if (!notes || notes.length < 20) return null;

  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `Below are broker email notes or manually pasted underwriting notes for a NYC property.

Extract ONLY the current rent, expense, occupancy, and underwriting facts that are explicitly stated in the notes. Do not invent missing values.

Return ONE JSON object with these keys:
- propertyInfo: { totalUnits, unitsResidential, unitsCommercial }
- rentRoll: array of objects with any relevant fields from { unit, building, unitCategory, tenantName, monthlyRent, monthlyBaseRent, monthlyTotalRent, annualRent, annualBaseRent, annualTotalRent, beds, baths, sqft, rentType, tenantStatus, leaseType, leaseStartDate, leaseEndDate, reimbursementType, reimbursementAmount, rentEscalations, occupied, lastRentedDate, dateVacant, notes, projectedMonthlyRentLow, projectedMonthlyRentHigh, projectedAnnualRentLow, projectedAnnualRentHigh }
- expenses: { expensesTable: [{ lineItem, amount }], totalExpenses }
- currentFinancials: { grossRentalIncome, otherIncome, operatingExpenses, noi, vacancyLoss, effectiveGrossIncome }
- notesSummary: short 1-2 sentence summary of the usable financial points
- investmentTakeaways: array of 1-4 concise bullets

Rules:
- If the notes provide unit-level rents, put them in rentRoll.
- If the notes provide only totals, keep totals in currentFinancials and/or expenses.
- If a broker describes a vacant or owner's unit with a projected rent range, capture that in projectedMonthlyRentLow/projectedMonthlyRentHigh or projectedAnnualRentLow/projectedAnnualRentHigh.
- If a value is not stated, use null or omit it.
- Output valid JSON only.

Notes:
${notes.slice(0, 15000)}`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content);
    if (!parsed) return null;

    const propertyInfo = asRecord(parsed.propertyInfo);
    const rentRoll = sanitizeRentRoll(parsed.rentRoll);
    const expenses = sanitizeExpenses(parsed.expenses);
    const currentFinancials = sanitizeCurrentFinancials(parsed.currentFinancials);
    const notesSummary = trimmedString(parsed.notesSummary);
    const investmentTakeaways = sanitizeTakeaways(parsed.investmentTakeaways);

    if (
      propertyInfo == null &&
      rentRoll == null &&
      expenses == null &&
      currentFinancials == null &&
      notesSummary == null &&
      investmentTakeaways == null
    ) {
      return null;
    }

    return {
      propertyInfo,
      rentRoll,
      expenses,
      currentFinancials,
      notesSummary,
      investmentTakeaways,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[extractBrokerDossierNotes]", message);
    return null;
  }
}

export function mergeBrokerNotesIntoDetails(
  details: PropertyDetails | null | undefined,
  extract: BrokerDossierNotesExtract | null | undefined
): PropertyDetails | null {
  const baseDetails = (details ?? {}) as PropertyDetails;
  if (!extract) return baseDetails;

  const baseSnapshot = getAuthoritativeOmSnapshot(baseDetails);
  const basePropertyInfo = asRecord(baseSnapshot?.propertyInfo);
  const baseExpensesTable = sanitizeExpenseTableRows(baseSnapshot?.expenses?.expensesTable ?? []);
  const baseRentRoll = sanitizeOmRentRollRows(baseSnapshot?.rentRoll ?? []);

  const notePropertyInfo = asRecord(extract.propertyInfo);
  const noteRentRoll = sanitizeOmRentRollRows(extract.rentRoll ?? []);
  const noteExpensesTable = sanitizeExpenseTableRows(extract.expenses?.expensesTable ?? []);

  const mergedRentRoll = noteRentRoll.length > 0 ? noteRentRoll : baseRentRoll;
  const mergedExpensesTable = noteExpensesTable.length > 0 ? noteExpensesTable : baseExpensesTable;
  const totalExpenses = firstFiniteNumber(
    extract.expenses?.totalExpenses,
    sumExpenses(mergedExpensesTable),
    baseSnapshot?.expenses?.totalExpenses
  );

  const mergedSnapshot: OmAuthoritativeSnapshot = {
    ...(baseSnapshot ?? {}),
    propertyInfo: mergedPropertyInfo(
      basePropertyInfo,
      notePropertyInfo,
      mergedRentRoll.length > 0 ? mergedRentRoll : null
    ),
    rentRoll: mergedRentRoll.length > 0 ? mergedRentRoll : null,
    expenses:
      mergedExpensesTable.length > 0 || totalExpenses != null
        ? {
            ...(baseSnapshot?.expenses ?? {}),
            expensesTable: mergedExpensesTable.length > 0 ? mergedExpensesTable : null,
            totalExpenses,
          }
        : baseSnapshot?.expenses ?? null,
    currentFinancials: mergedCurrentFinancials(
      baseSnapshot?.currentFinancials ?? null,
      extract.currentFinancials ?? null,
      mergedRentRoll.length > 0 ? mergedRentRoll : null,
      totalExpenses != null ? { totalExpenses } : null
    ),
    coverage: {
      ...(baseSnapshot?.coverage ?? {}),
      rentRollExtracted:
        noteRentRoll.length > 0 ? true : (baseSnapshot?.coverage?.rentRollExtracted ?? null),
      expensesExtracted:
        noteExpensesTable.length > 0 || extract.expenses?.totalExpenses != null
          ? true
          : (baseSnapshot?.coverage?.expensesExtracted ?? null),
      currentFinancialsExtracted:
        extract.currentFinancials != null
          ? true
          : (baseSnapshot?.coverage?.currentFinancialsExtracted ?? null),
      unitCountExtracted:
        firstFiniteNumber(notePropertyInfo?.totalUnits, notePropertyInfo?.unitsTotal) != null ||
        noteRentRoll.length > 0
          ? true
          : (baseSnapshot?.coverage?.unitCountExtracted ?? null),
    },
    sourceMeta: {
      ...(baseSnapshot?.sourceMeta ?? {}),
      dossierBrokerNotes: {
        used: true,
        notesSummary: extract.notesSummary ?? null,
        investmentTakeaways: extract.investmentTakeaways ?? null,
      },
    },
  };

  return {
    ...baseDetails,
    omData: {
      ...(baseDetails.omData ?? {}),
      authoritative: mergedSnapshot,
    },
  };
}
