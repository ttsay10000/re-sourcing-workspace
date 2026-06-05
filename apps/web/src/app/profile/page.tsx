"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DEFAULT_SAVED_SEARCH_AREAS = ["all-downtown", "all-midtown"] as const;
const DEFAULT_SAVED_SEARCH_TIMEZONE = "America/New_York";
const DEFAULT_SAVED_SEARCH_LIMIT = "100";
const SAVED_SEARCH_WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
] as const;
const SAVED_SEARCH_TYPE_OPTIONS = [
  { value: "condo", label: "Condo" },
  { value: "coop", label: "Co-op" },
  { value: "house", label: "House" },
  { value: "multi_family", label: "Multi-family" },
] as const;
const DEFAULT_SCORING_PREFERENCES = {
  targetIrrPct: 25,
  goodCashOnCashPct: 2,
  rentStabilizationDoNotBuy: false,
  scoringProfileKey: "legacy_v3",
} as const;

type SearchCadence = "manual" | "daily" | "weekly" | "monthly";
type ProfileFieldKey = "name" | "email" | "organization";
type AssumptionFieldKey =
  | "defaultPurchaseClosingCostPct"
  | "defaultLtv"
  | "defaultInterestRate"
  | "defaultAmortization"
  | "defaultLoanFeePct"
  | "defaultHoldPeriodYears"
  | "defaultExitCap"
  | "defaultExitClosingCostPct"
  | "defaultRentUplift"
  | "defaultExpenseIncrease"
  | "defaultManagementFee"
  | "defaultVacancyPct"
  | "defaultLeadTimeMonths"
  | "defaultAnnualRentGrowthPct"
  | "defaultAnnualCommercialRentGrowthPct"
  | "defaultAnnualOtherIncomeGrowthPct"
  | "defaultAnnualExpenseGrowthPct"
  | "defaultAnnualPropertyTaxGrowthPct"
  | "defaultRecurringCapexAnnual"
  | "defaultTargetIrrPct";

interface AssumptionFieldDefinition {
  key: AssumptionFieldKey;
  label: string;
  step?: string;
  min?: number;
  max?: number;
}

const profileFields: Array<{ key: ProfileFieldKey; label: string; type: "text" | "email" }> = [
  { key: "name", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "organization", label: "Organization", type: "text" },
] as const;
const assumptionSections: Array<{
  title: string;
  description: string;
  fields: AssumptionFieldDefinition[];
}> = [
  {
    title: "Financing",
    description: "Debt structure defaults used to seed new analyses.",
    fields: [
      { key: "defaultPurchaseClosingCostPct", label: "Purchase closing costs (%)", step: "0.1" },
      { key: "defaultLtv", label: "LTV (%)" },
      { key: "defaultInterestRate", label: "Interest rate (%)", step: "0.1" },
      { key: "defaultAmortization", label: "Amortization (years)" },
      { key: "defaultLoanFeePct", label: "Loan fee (%)", step: "0.1" },
    ],
  },
  {
    title: "Operations",
    description: "Income lift and operating drag assumptions before long-term growth.",
    fields: [
      { key: "defaultRentUplift", label: "Rent uplift (%)", step: "0.1" },
      { key: "defaultExpenseIncrease", label: "Expense increase (%)", step: "0.1" },
      { key: "defaultManagementFee", label: "Management fee (%)", step: "0.1" },
      { key: "defaultVacancyPct", label: "Vacancy (%)", step: "0.1" },
      { key: "defaultLeadTimeMonths", label: "Lead time (months)" },
    ],
  },
  {
    title: "Growth and reserves",
    description: "Annual escalators and recurring reserve assumptions.",
    fields: [
      { key: "defaultAnnualRentGrowthPct", label: "Annual FM rent growth (%)", step: "0.1" },
      { key: "defaultAnnualCommercialRentGrowthPct", label: "Annual commercial rent growth (%)", step: "0.1" },
      { key: "defaultAnnualOtherIncomeGrowthPct", label: "Annual other income growth (%)", step: "0.1" },
      { key: "defaultAnnualExpenseGrowthPct", label: "Annual expense growth (%)", step: "0.1" },
      { key: "defaultAnnualPropertyTaxGrowthPct", label: "Fallback annual property tax growth (%)", step: "0.1" },
      { key: "defaultRecurringCapexAnnual", label: "Recurring CapEx reserve", step: "100" },
    ],
  },
  {
    title: "Disposition",
    description: "Return targets and terminal assumptions for exit underwriting.",
    fields: [
      { key: "defaultHoldPeriodYears", label: "Hold period (years)", min: 1, max: 10 },
      { key: "defaultExitCap", label: "Exit cap (%)", step: "0.1" },
      { key: "defaultExitClosingCostPct", label: "Exit closing costs (%)", step: "0.1" },
      { key: "defaultTargetIrrPct", label: "Target IRR (%)", step: "0.1" },
    ],
  },
] as const;

interface UserProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  automationPaused?: boolean;
  automationPauseReason?: string | null;
  automationPausedAt?: string | null;
  automationInitialEmailEnabled?: boolean;
  automationReplyEmailEnabled?: boolean;
  automationAmbiguousActionHandlingEnabled?: boolean;
  defaultPurchaseClosingCostPct?: number | null;
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultHoldPeriodYears?: number | null;
  defaultExitCap?: number | null;
  defaultExitClosingCostPct?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
  defaultTargetIrrPct?: number | null;
  defaultVacancyPct?: number | null;
  defaultLeadTimeMonths?: number | null;
  defaultAnnualRentGrowthPct?: number | null;
  defaultAnnualCommercialRentGrowthPct?: number | null;
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
  scoringPreferences?: {
    targetIrrPct?: number | null;
    goodCashOnCashPct?: number | null;
    rentStabilizationDoNotBuy?: boolean;
    scoringProfileKey?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface ProfileSavedDealRow {
  savedDeal?: {
    id: string;
    propertyId: string;
    dealStatus: string;
    createdAt: string;
  };
  propertyId?: string;
  address?: string;
  canonicalAddress?: string;
  price: number | null;
  units: number | null;
  buildingSqft?: number | null;
  pricePerSqft?: number | null;
  dealScore: number | null;
  imageUrl?: string | null;
}

interface SavedSearch {
  id: string;
  name: string;
  enabled: boolean;
  locationMode: "single" | "multi";
  singleLocationSlug: string | null;
  areaCodes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minBeds: number | null;
  maxBeds: number | null;
  minBaths: number | null;
  maxBaths: number | null;
  maxHoa: number | null;
  maxTax: number | null;
  requiredAmenities: string[];
  propertyTypes: string[];
  scheduleCadence: SearchCadence;
  timezone: string;
  runTimeLocal: string | null;
  weeklyRunDay: number | null;
  monthlyRunDay: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  resultLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedSearchDraft {
  name: string;
  enabled: boolean;
  areaInput: string;
  minPrice: string;
  maxPrice: string;
  minBeds: string;
  maxBeds: string;
  minBaths: string;
  maxHoa: string;
  maxTax: string;
  amenities: string;
  propertyTypes: string[];
  resultLimit: string;
  scheduleCadence: SearchCadence;
  timezone: string;
  runTimeLocal: string;
  weeklyRunDay: string;
  monthlyRunDay: string;
}

const DEFAULT_SAVED_SEARCH_DRAFT: SavedSearchDraft = {
  name: "",
  enabled: true,
  areaInput: "",
  minPrice: "",
  maxPrice: "",
  minBeds: "",
  maxBeds: "",
  minBaths: "",
  maxHoa: "",
  maxTax: "",
  amenities: "",
  propertyTypes: [],
  resultLimit: DEFAULT_SAVED_SEARCH_LIMIT,
  scheduleCadence: "daily",
  timezone: DEFAULT_SAVED_SEARCH_TIMEZONE,
  runTimeLocal: "08:00",
  weeklyRunDay: "1",
  monthlyRunDay: "1",
};

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toTimeInputValue(value: string | null | undefined): string {
  if (!value) return "08:00";
  const [hours = "08", minutes = "00"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Never" : parsed.toLocaleString();
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatSavedSearchAreas(search: SavedSearch): string {
  if (search.locationMode === "single" && search.singleLocationSlug) return search.singleLocationSlug;
  const areaCodes = Array.isArray(search.areaCodes) ? search.areaCodes : [];
  if (areaCodes.length > 0) return areaCodes.join(", ");
  return DEFAULT_SAVED_SEARCH_AREAS.join(", ");
}

function formatSavedSearchSchedule(search: SavedSearch): string {
  if (search.scheduleCadence === "manual") return "Manual only";
  const time = toTimeInputValue(search.runTimeLocal);
  if (search.scheduleCadence === "daily") return `Daily at ${time} (${search.timezone})`;
  if (search.scheduleCadence === "weekly") {
    const weekday = SAVED_SEARCH_WEEKDAY_OPTIONS.find((option) => Number(option.value) === search.weeklyRunDay)?.label ?? "Monday";
    return `Weekly on ${weekday} at ${time} (${search.timezone})`;
  }
  return `Monthly on day ${search.monthlyRunDay ?? 1} at ${time} (${search.timezone})`;
}

function formatSavedSearchFilters(search: SavedSearch): string {
  const propertyTypes = Array.isArray(search.propertyTypes) ? search.propertyTypes : [];
  const requiredAmenities = Array.isArray(search.requiredAmenities) ? search.requiredAmenities : [];
  const filters: string[] = [`Areas: ${formatSavedSearchAreas(search)}`];
  if (search.minPrice != null || search.maxPrice != null) {
    filters.push(
      `Price: ${search.minPrice != null ? currencyFormatter.format(search.minPrice) : "any"}-${search.maxPrice != null ? currencyFormatter.format(search.maxPrice) : "any"}`
    );
  }
  if (search.minBeds != null || search.maxBeds != null) {
    filters.push(`Beds: ${search.minBeds ?? "any"}-${search.maxBeds ?? "any"}`);
  }
  if (search.minBaths != null) filters.push(`Min baths: ${search.minBaths}`);
  if (search.maxHoa != null) filters.push(`Max HOA: ${currencyFormatter.format(search.maxHoa)}`);
  if (search.maxTax != null) filters.push(`Max tax: ${currencyFormatter.format(search.maxTax)}`);
  if (propertyTypes.length > 0) filters.push(`Types: ${propertyTypes.join(", ")}`);
  if (requiredAmenities.length > 0) filters.push(`Amenities: ${requiredAmenities.join(", ")}`);
  if (search.resultLimit != null) filters.push(`Limit: ${search.resultLimit}`);
  return filters.join(" | ");
}

function profileSavedDealPropertyId(row: ProfileSavedDealRow): string {
  return row.savedDeal?.propertyId ?? row.propertyId ?? "";
}

function profileSavedDealId(row: ProfileSavedDealRow): string {
  return row.savedDeal?.id ?? profileSavedDealPropertyId(row) ?? row.address ?? row.canonicalAddress ?? "saved-deal";
}

function profileSavedDealAddress(row: ProfileSavedDealRow): string {
  return row.address ?? row.canonicalAddress ?? "—";
}

function profileSavedDealStatus(row: ProfileSavedDealRow): string {
  return row.savedDeal?.dealStatus ?? "saved";
}

function profileSavedDealCreatedAt(row: ProfileSavedDealRow): string | null {
  return row.savedDeal?.createdAt ?? null;
}

function labelFromKey(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function profileSavedDealScoreClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "profile-saved-deals-score profile-saved-deals-score--empty";
  if (score >= 70) return "profile-saved-deals-score profile-saved-deals-score--strong";
  if (score >= 50) return "profile-saved-deals-score profile-saved-deals-score--watch";
  return "profile-saved-deals-score profile-saved-deals-score--weak";
}

function profileSavedDealStatusClass(status: string | null | undefined): string {
  if (status === "rejected") return "profile-mini-status profile-mini-status--danger";
  if (
    status === "saved" ||
    status === "om_received" ||
    status === "dossier_generated" ||
    status === "contract_signed" ||
    status === "deal_closed"
  ) {
    return "profile-mini-status profile-mini-status--success";
  }
  if (status === "underwriting" || status === "offer_review" || status === "negotiation" || status === "awaiting_broker") {
    return "profile-mini-status profile-mini-status--warning";
  }
  if (status === "outreach" || status === "screening") return "profile-mini-status profile-mini-status--info";
  return "profile-mini-status profile-mini-status--neutral";
}

function matchesSearchQuery(values: Array<string | number | boolean | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function buildSavedSearchDraft(search?: SavedSearch | null): SavedSearchDraft {
  if (!search) return { ...DEFAULT_SAVED_SEARCH_DRAFT };
  return {
    name: search.name,
    enabled: search.enabled,
    areaInput: search.locationMode === "single"
      ? (search.singleLocationSlug ?? "")
      : (search.areaCodes.length > 0 ? search.areaCodes.join(", ") : DEFAULT_SAVED_SEARCH_AREAS.join(", ")),
    minPrice: search.minPrice != null ? String(search.minPrice) : "",
    maxPrice: search.maxPrice != null ? String(search.maxPrice) : "",
    minBeds: search.minBeds != null ? String(search.minBeds) : "",
    maxBeds: search.maxBeds != null ? String(search.maxBeds) : "",
    minBaths: search.minBaths != null ? String(search.minBaths) : "",
    maxHoa: search.maxHoa != null ? String(search.maxHoa) : "",
    maxTax: search.maxTax != null ? String(search.maxTax) : "",
    amenities: search.requiredAmenities.join(", "),
    propertyTypes: search.propertyTypes,
    resultLimit: search.resultLimit != null ? String(search.resultLimit) : DEFAULT_SAVED_SEARCH_LIMIT,
    scheduleCadence: search.scheduleCadence,
    timezone: search.timezone || DEFAULT_SAVED_SEARCH_TIMEZONE,
    runTimeLocal: toTimeInputValue(search.runTimeLocal),
    weeklyRunDay: String(search.weeklyRunDay ?? 1),
    monthlyRunDay: String(search.monthlyRunDay ?? 1),
  };
}

function buildSavedSearchPayload(draft: SavedSearchDraft) {
  const areas = parseCsvList(draft.areaInput);
  const selectedAreas = areas.length > 0 ? areas : [...DEFAULT_SAVED_SEARCH_AREAS];
  return {
    name: draft.name.trim() || "Saved search",
    enabled: draft.enabled,
    locationMode: selectedAreas.length === 1 ? "single" : "multi",
    singleLocationSlug: selectedAreas.length === 1 ? selectedAreas[0] : null,
    areaCodes: selectedAreas.length === 1 ? [] : selectedAreas,
    minPrice: parseOptionalNumber(draft.minPrice),
    maxPrice: parseOptionalNumber(draft.maxPrice),
    minBeds: parseOptionalNumber(draft.minBeds),
    maxBeds: parseOptionalNumber(draft.maxBeds),
    minBaths: parseOptionalNumber(draft.minBaths),
    maxHoa: parseOptionalNumber(draft.maxHoa),
    maxTax: parseOptionalNumber(draft.maxTax),
    requiredAmenities: parseCsvList(draft.amenities),
    propertyTypes: draft.propertyTypes,
    sourceToggles: { streeteasy: true, manual: false },
    scheduleCadence: draft.scheduleCadence,
    timezone: draft.timezone.trim() || DEFAULT_SAVED_SEARCH_TIMEZONE,
    runTimeLocal: draft.scheduleCadence === "manual" ? null : (draft.runTimeLocal || "08:00"),
    weeklyRunDay: draft.scheduleCadence === "weekly" ? Number(draft.weeklyRunDay || "1") : null,
    monthlyRunDay: draft.scheduleCadence === "monthly" ? Number(draft.monthlyRunDay || "1") : null,
    resultLimit: parseOptionalNumber(draft.resultLimit),
  };
}

function ProfilePageContent() {
  const searchParams = useSearchParams();
  const globalQuery = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<UserProfile>>({});
  const [savedDeals, setSavedDeals] = useState<ProfileSavedDealRow[]>([]);
  const [savedDealsLoading, setSavedDealsLoading] = useState(false);
  const [refreshingScoreScope, setRefreshingScoreScope] = useState<"saved" | "all" | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(true);
  const [savedSearchDraft, setSavedSearchDraft] = useState<SavedSearchDraft>(DEFAULT_SAVED_SEARCH_DRAFT);
  const [editingSavedSearchId, setEditingSavedSearchId] = useState<string | null>(null);
  const [savingSavedSearch, setSavingSavedSearch] = useState(false);
  const [runningSavedSearchId, setRunningSavedSearchId] = useState<string | null>(null);
  const [deletingSavedSearchId, setDeletingSavedSearchId] = useState<string | null>(null);
  const [savedSearchError, setSavedSearchError] = useState<string | null>(null);
  const [savedSearchNotice, setSavedSearchNotice] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load profile");
      setProfile(data);
      setDraft({
        name: data.name ?? "",
        email: data.email ?? "",
        organization: data.organization ?? "",
        automationPaused: data.automationPaused === true,
        automationPauseReason: data.automationPauseReason ?? "",
        automationInitialEmailEnabled: data.automationInitialEmailEnabled === true,
        automationReplyEmailEnabled: data.automationReplyEmailEnabled === true,
        automationAmbiguousActionHandlingEnabled: data.automationAmbiguousActionHandlingEnabled === true,
        defaultPurchaseClosingCostPct: data.defaultPurchaseClosingCostPct ?? 3,
        defaultLtv: data.defaultLtv ?? 64,
        defaultInterestRate: data.defaultInterestRate ?? 6,
        defaultAmortization: data.defaultAmortization ?? 30,
        defaultHoldPeriodYears: data.defaultHoldPeriodYears ?? 2,
        defaultExitCap: data.defaultExitCap ?? 5,
        defaultExitClosingCostPct: data.defaultExitClosingCostPct ?? 6,
        defaultRentUplift: data.defaultRentUplift ?? 76.3,
        defaultExpenseIncrease: data.defaultExpenseIncrease ?? 0,
        defaultManagementFee: data.defaultManagementFee ?? 8,
        defaultTargetIrrPct: data.defaultTargetIrrPct ?? 25,
        defaultVacancyPct: data.defaultVacancyPct ?? 15,
        defaultLeadTimeMonths: data.defaultLeadTimeMonths ?? 2,
        defaultAnnualRentGrowthPct: data.defaultAnnualRentGrowthPct ?? 1,
        defaultAnnualCommercialRentGrowthPct: data.defaultAnnualCommercialRentGrowthPct ?? 1.5,
        defaultAnnualOtherIncomeGrowthPct: data.defaultAnnualOtherIncomeGrowthPct ?? 0,
        defaultAnnualExpenseGrowthPct: data.defaultAnnualExpenseGrowthPct ?? 0,
        defaultAnnualPropertyTaxGrowthPct: data.defaultAnnualPropertyTaxGrowthPct ?? 6,
        defaultRecurringCapexAnnual: data.defaultRecurringCapexAnnual ?? 1200,
        defaultLoanFeePct: data.defaultLoanFeePct ?? 0.63,
        scoringPreferences: {
          targetIrrPct: data.scoringPreferences?.targetIrrPct ?? DEFAULT_SCORING_PREFERENCES.targetIrrPct,
          goodCashOnCashPct:
            data.scoringPreferences?.goodCashOnCashPct ?? DEFAULT_SCORING_PREFERENCES.goodCashOnCashPct,
          rentStabilizationDoNotBuy:
            data.scoringPreferences?.rentStabilizationDoNotBuy ??
            DEFAULT_SCORING_PREFERENCES.rentStabilizationDoNotBuy,
          scoringProfileKey:
            data.scoringPreferences?.scoringProfileKey ?? DEFAULT_SCORING_PREFERENCES.scoringProfileKey,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name ?? profile.name,
          email: draft.email ?? profile.email,
          organization: draft.organization ?? profile.organization,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save");
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAutomationSettings = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automationPaused: draft.automationPaused === true,
          automationPauseReason:
            draft.automationPaused === true
              ? typeof draft.automationPauseReason === "string" && draft.automationPauseReason.trim().length > 0
                ? draft.automationPauseReason.trim()
                : "Paused from profile"
              : null,
          automationInitialEmailEnabled: draft.automationInitialEmailEnabled === true,
          automationReplyEmailEnabled: draft.automationReplyEmailEnabled === true,
          automationAmbiguousActionHandlingEnabled: draft.automationAmbiguousActionHandlingEnabled === true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save automation settings");
      setProfile(data);
      setDraft((prev) => ({
        ...prev,
        automationPaused: data.automationPaused === true,
        automationPauseReason: data.automationPauseReason ?? "",
        automationInitialEmailEnabled: data.automationInitialEmailEnabled === true,
        automationReplyEmailEnabled: data.automationReplyEmailEnabled === true,
        automationAmbiguousActionHandlingEnabled: data.automationAmbiguousActionHandlingEnabled === true,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save automation settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAssumptions = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultPurchaseClosingCostPct: draft.defaultPurchaseClosingCostPct ?? profile.defaultPurchaseClosingCostPct,
          defaultLtv: draft.defaultLtv ?? profile.defaultLtv,
          defaultInterestRate: draft.defaultInterestRate ?? profile.defaultInterestRate,
          defaultAmortization: draft.defaultAmortization ?? profile.defaultAmortization,
          defaultHoldPeriodYears: draft.defaultHoldPeriodYears ?? profile.defaultHoldPeriodYears,
          defaultExitCap: draft.defaultExitCap ?? profile.defaultExitCap,
          defaultExitClosingCostPct: draft.defaultExitClosingCostPct ?? profile.defaultExitClosingCostPct,
          defaultRentUplift: draft.defaultRentUplift ?? profile.defaultRentUplift,
          defaultExpenseIncrease: draft.defaultExpenseIncrease ?? profile.defaultExpenseIncrease,
          defaultManagementFee: draft.defaultManagementFee ?? profile.defaultManagementFee,
          defaultTargetIrrPct: draft.defaultTargetIrrPct ?? profile.defaultTargetIrrPct,
          defaultVacancyPct: draft.defaultVacancyPct ?? profile.defaultVacancyPct,
          defaultLeadTimeMonths: draft.defaultLeadTimeMonths ?? profile.defaultLeadTimeMonths,
          defaultAnnualRentGrowthPct:
            draft.defaultAnnualRentGrowthPct ?? profile.defaultAnnualRentGrowthPct,
          defaultAnnualCommercialRentGrowthPct:
            draft.defaultAnnualCommercialRentGrowthPct ?? profile.defaultAnnualCommercialRentGrowthPct,
          defaultAnnualOtherIncomeGrowthPct:
            draft.defaultAnnualOtherIncomeGrowthPct ?? profile.defaultAnnualOtherIncomeGrowthPct,
          defaultAnnualExpenseGrowthPct:
            draft.defaultAnnualExpenseGrowthPct ?? profile.defaultAnnualExpenseGrowthPct,
          defaultAnnualPropertyTaxGrowthPct:
            draft.defaultAnnualPropertyTaxGrowthPct ?? profile.defaultAnnualPropertyTaxGrowthPct,
          defaultRecurringCapexAnnual:
            draft.defaultRecurringCapexAnnual ?? profile.defaultRecurringCapexAnnual,
          defaultLoanFeePct: draft.defaultLoanFeePct ?? profile.defaultLoanFeePct,
          scoringPreferences: draft.scoringPreferences ?? profile.scoringPreferences ?? DEFAULT_SCORING_PREFERENCES,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save");
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const fetchSavedDeals = useCallback(async () => {
    setSavedDealsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile/saved-deals`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load");
      setSavedDeals(data.savedDeals ?? []);
    } catch {
      setSavedDeals([]);
    } finally {
      setSavedDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedDeals();
  }, [fetchSavedDeals]);

  const fetchSavedSearches = useCallback(async () => {
    setSavedSearchesLoading(true);
    setSavedSearchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load saved searches");
      setSavedSearches(data.savedSearches ?? []);
    } catch (e) {
      setSavedSearchError(e instanceof Error ? e.message : "Failed to load saved searches");
      setSavedSearches([]);
    } finally {
      setSavedSearchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSavedSearches();
  }, [fetchSavedSearches]);

  const handleUnsave = async (propertyId: string) => {
    try {
      await fetch(`${API_BASE}/api/profile/saved-deals/${encodeURIComponent(propertyId)}`, { method: "DELETE" });
      setSavedDeals((prev) => prev.filter((row) => profileSavedDealPropertyId(row) !== propertyId));
    } catch {
      // ignore
    }
  };

  const handleRefreshScores = async (scope: "saved" | "all") => {
    setRefreshingScoreScope(scope);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/dossier/refresh-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.details || data?.error || "Failed to refresh scores");
      }
      await fetchSavedDeals();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh scores");
    } finally {
      setRefreshingScoreScope(null);
    }
  };

  const handleGenerateStandardLeverage = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile/generate-standard-leverage`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to set");
      setProfile(data);
      setDraft((prev) => ({
        ...prev,
        defaultLtv: 65,
        defaultInterestRate: 6.5,
        defaultAmortization: 30,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set standard leverage");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSavedSearch = (search: SavedSearch) => {
    setEditingSavedSearchId(search.id);
    setSavedSearchDraft(buildSavedSearchDraft(search));
    setSavedSearchNotice(null);
    setSavedSearchError(null);
  };

  const handleResetSavedSearchDraft = (options?: { preserveMessages?: boolean }) => {
    setEditingSavedSearchId(null);
    setSavedSearchDraft({ ...DEFAULT_SAVED_SEARCH_DRAFT });
    if (!options?.preserveMessages) {
      setSavedSearchNotice(null);
      setSavedSearchError(null);
    }
  };

  const handleSaveSavedSearch = async () => {
    setSavingSavedSearch(true);
    setSavedSearchError(null);
    setSavedSearchNotice(null);
    try {
      const isEditing = Boolean(editingSavedSearchId);
      const res = await fetch(
        isEditing
          ? `${API_BASE}/api/saved-searches/${encodeURIComponent(editingSavedSearchId!)}`
          : `${API_BASE}/api/saved-searches`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSavedSearchPayload(savedSearchDraft)),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save saved search");
      handleResetSavedSearchDraft({ preserveMessages: true });
      setSavedSearchNotice(isEditing ? "Saved search updated." : "Saved search created.");
      await fetchSavedSearches();
    } catch (e) {
      setSavedSearchError(e instanceof Error ? e.message : "Failed to save saved search");
    } finally {
      setSavingSavedSearch(false);
    }
  };

  const handleRunSavedSearchNow = async (savedSearchId: string) => {
    setRunningSavedSearchId(savedSearchId);
    setSavedSearchError(null);
    setSavedSearchNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${encodeURIComponent(savedSearchId)}/run-now`, { method: "POST" });
      const data = await res.json();
      if (res.status === 409 || data?.code === "already_running") {
        setSavedSearchNotice("Saved search is already running. Open Pipeline for live workflow tracking while the current run finishes.");
        await fetchSavedSearches();
        return;
      }
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start saved search");
      setSavedSearchNotice("Saved search started. Open Pipeline for live workflow tracking.");
      await fetchSavedSearches();
    } catch (e) {
      setSavedSearchError(e instanceof Error ? e.message : "Failed to start saved search");
    } finally {
      setRunningSavedSearchId(null);
    }
  };

  const handleDeleteSavedSearch = async (savedSearchId: string) => {
    setDeletingSavedSearchId(savedSearchId);
    setSavedSearchError(null);
    setSavedSearchNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${encodeURIComponent(savedSearchId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to delete saved search");
      if (editingSavedSearchId === savedSearchId) handleResetSavedSearchDraft();
      setSavedSearchNotice("Saved search deleted.");
      await fetchSavedSearches();
    } catch (e) {
      setSavedSearchError(e instanceof Error ? e.message : "Failed to delete saved search");
    } finally {
      setDeletingSavedSearchId(null);
    }
  };

  const filteredSavedSearches = useMemo(() => {
    if (!globalQuery) return savedSearches;
    return savedSearches.filter((search) =>
      matchesSearchQuery(
        [
          search.name,
          search.enabled ? "enabled" : "paused",
          formatSavedSearchSchedule(search),
          formatSavedSearchFilters(search),
          search.timezone,
          search.scheduleCadence,
          Array.isArray(search.areaCodes) ? search.areaCodes.join(" ") : "",
          search.singleLocationSlug,
          Array.isArray(search.propertyTypes) ? search.propertyTypes.join(" ") : "",
          Array.isArray(search.requiredAmenities) ? search.requiredAmenities.join(" ") : "",
        ],
        globalQuery
      )
    );
  }, [globalQuery, savedSearches]);

  const filteredSavedDeals = useMemo(() => {
    if (!globalQuery) return savedDeals;
    return savedDeals.filter((row) =>
      matchesSearchQuery(
        [
          profileSavedDealAddress(row),
          profileSavedDealPropertyId(row),
          profileSavedDealStatus(row),
          row.price,
          row.units,
          row.dealScore,
          row.imageUrl,
          profileSavedDealCreatedAt(row),
        ],
        globalQuery
      )
    );
  }, [globalQuery, savedDeals]);

  if (loading) {
    return (
      <div className="profile-page profile-v2 profile-v2-loading" style={{ padding: "1.5rem" }}>
        <h1 className="page-title">Profile</h1>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="profile-page profile-page--holistic profile-v2">
      <header className="profile-page-header">
        <div>
          <p className="profile-page-kicker">Profile workspace</p>
          <h1 className="page-title profile-page-title">Profile</h1>
          <p className="profile-page-intro">
            Keep underwriting defaults tidy here so deal-specific inputs only need lightweight edits downstream.
          </p>
        </div>
        <div className="profile-page-summary">
          <div className="profile-page-summary-item">
            <span>Account fields</span>
            <strong>{profileFields.length}</strong>
          </div>
          <div className="profile-page-summary-item">
            <span>Assumptions</span>
            <strong>{assumptionSections.reduce((total, section) => total + section.fields.length, 0)}</strong>
          </div>
          <div className="profile-page-summary-item">
            <span>Saved searches</span>
            <strong>{savedSearches.length}</strong>
          </div>
          <div className="profile-page-summary-item">
            <span>Saved deals</span>
            <strong>{savedDeals.length}</strong>
          </div>
        </div>
      </header>
      {globalQuery && (
        <div className="profile-v2-query">
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>
            {filteredSavedSearches.length} search{filteredSavedSearches.length === 1 ? "" : "es"} · {filteredSavedDeals.length} deal{filteredSavedDeals.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {error && <p className="profile-page-error">{error}</p>}

      <section className="profile-section profile-identity-section">
        <div className="profile-section-heading">
          <div>
            <h2>Account</h2>
            <p>Core profile details used across sourcing, underwriting, and dossier workflows.</p>
          </div>
          <button type="button" onClick={handleSaveProfile} disabled={saving} className="profile-primary-button">
            {saving ? "Saving…" : "Save account"}
          </button>
        </div>
        <div className="profile-form-grid profile-form-grid--compact">
          {profileFields.map((field) => (
            <label key={field.key} className="profile-field">
              <span>{field.label}</span>
              <input
                type={field.type}
                value={draft[field.key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="profile-input"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <h2>Email automation</h2>
            <p>Saved-search broker outreach controls. Initial OM requests are off unless you explicitly enable them.</p>
          </div>
          <button
            type="button"
            onClick={handleSaveAutomationSettings}
            disabled={saving}
            className="profile-primary-button"
          >
            {saving ? "Saving…" : "Save automation"}
          </button>
        </div>
        <div className="profile-form-grid profile-form-grid--compact">
          <label className="profile-field">
            <span>Pause all scheduled automation</span>
            <input
              type="checkbox"
              checked={draft.automationPaused === true}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  automationPaused: e.target.checked,
                  automationPauseReason: e.target.checked
                    ? (typeof prev.automationPauseReason === "string" && prev.automationPauseReason.trim().length > 0
                        ? prev.automationPauseReason
                        : "Paused from profile")
                    : "",
                }))
              }
            />
          </label>
          <label className="profile-field">
            <span>Auto-send initial OM requests</span>
            <input
              type="checkbox"
              checked={draft.automationInitialEmailEnabled === true}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, automationInitialEmailEnabled: e.target.checked }))
              }
            />
          </label>
          <label className="profile-field">
            <span>Auto-send replies</span>
            <input
              type="checkbox"
              checked={draft.automationReplyEmailEnabled === true}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, automationReplyEmailEnabled: e.target.checked }))
              }
            />
          </label>
          <label className="profile-field">
            <span>Auto-handle ambiguous actions</span>
            <input
              type="checkbox"
              checked={draft.automationAmbiguousActionHandlingEnabled === true}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  automationAmbiguousActionHandlingEnabled: e.target.checked,
                }))
              }
            />
          </label>
        </div>
        <p className="profile-section-note">
          Auto-send initial OM requests applies to eligible new properties from saved-search runs. The global server env gate must also be enabled. Pause all scheduled automation stops saved-search cron, inbox processing, and outreach cron. Reply automation and ambiguous-action handling are configuration only right now; no automatic replies or promotion paths are enabled.
        </p>
      </section>

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <h2>Underwriting assumptions</h2>
            <p>Reusable defaults for dossier underwriting. Deal-specific purchase, renovation, and furnishing costs still live on the property dossier flow.</p>
          </div>
          <button type="button" onClick={handleSaveAssumptions} disabled={saving} className="profile-primary-button">
            {saving ? "Saving…" : "Save assumptions"}
          </button>
        </div>
        <p className="profile-section-note profile-section-note--callout">
          Property-tax growth is auto-derived from NYC tax class when available. The fallback field below is only used when the property tax class is missing or not recognized.
        </p>
        <div className="profile-assumption-groups">
          {assumptionSections.map((section) => (
            <section key={section.title} className="profile-assumption-group">
              <div className="profile-assumption-group-header">
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </div>
              <div className="profile-form-grid profile-form-grid--grouped">
                {section.fields.map((field) => (
                  <label key={field.key} className="profile-field">
                    <span>{field.label}</span>
                    <input
                      type="number"
                      step={"step" in field ? field.step : undefined}
                      min={"min" in field ? field.min : undefined}
                      max={"max" in field ? field.max : undefined}
                      value={draft[field.key] ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [field.key]: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      className="profile-input"
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section className="profile-assumption-group profile-assumption-group--scoring">
          <div className="profile-assumption-group-header">
            <h3>Scoring preferences</h3>
            <p>Defaults for the overall deal score. Neighborhood context remains presentation-only.</p>
          </div>
          <div className="profile-form-grid profile-form-grid--grouped">
            <label className="profile-field">
              <span>Target IRR score anchor (%)</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={100}
                value={draft.scoringPreferences?.targetIrrPct ?? ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    scoringPreferences: {
                      ...(prev.scoringPreferences ?? profile?.scoringPreferences ?? DEFAULT_SCORING_PREFERENCES),
                      targetIrrPct: e.target.value ? Number(e.target.value) : DEFAULT_SCORING_PREFERENCES.targetIrrPct,
                    },
                  }))
                }
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Good cash-on-cash (%)</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={100}
                value={draft.scoringPreferences?.goodCashOnCashPct ?? ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    scoringPreferences: {
                      ...(prev.scoringPreferences ?? profile?.scoringPreferences ?? DEFAULT_SCORING_PREFERENCES),
                      goodCashOnCashPct: e.target.value ? Number(e.target.value) : DEFAULT_SCORING_PREFERENCES.goodCashOnCashPct,
                    },
                  }))
                }
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Default scoring family</span>
              <select
                value={draft.scoringPreferences?.scoringProfileKey ?? DEFAULT_SCORING_PREFERENCES.scoringProfileKey}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    scoringPreferences: {
                      ...(prev.scoringPreferences ?? profile?.scoringPreferences ?? DEFAULT_SCORING_PREFERENCES),
                      scoringProfileKey: e.target.value,
                    },
                  }))
                }
                className="profile-input"
              >
                <option value="legacy_v3">Deterministic v3</option>
                <option value="value_add_furnished_monthly_rental">Value-add / furnished monthly rental</option>
              </select>
            </label>
            <label className="profile-field profile-field--checkbox">
              <span>Rent stabilization/control do-not-buy</span>
              <input
                type="checkbox"
                checked={draft.scoringPreferences?.rentStabilizationDoNotBuy === true}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    scoringPreferences: {
                      ...(prev.scoringPreferences ?? profile?.scoringPreferences ?? DEFAULT_SCORING_PREFERENCES),
                      rentStabilizationDoNotBuy: e.target.checked,
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>
        <div className="profile-assumptions-toolbar">
          <button
            type="button"
            onClick={handleGenerateStandardLeverage}
            disabled={saving}
            className="profile-secondary-button"
          >
            Generate standard leverage
          </button>
          <span>LTV 65%, interest 6.5%, amortization 30 years.</span>
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <h2>Saved searches</h2>
            <p>Manage the automated sourcing searches that feed daily ingestion. Cron reads this list fresh on each scheduled run, so edits here apply to the next due execution.</p>
          </div>
          <Link href="/runs" className="profile-secondary-button">
            View run history
          </Link>
        </div>
        {savedSearchError && <p className="profile-page-error profile-page-message">{savedSearchError}</p>}
        {savedSearchNotice && <p className="profile-page-success profile-page-message">{savedSearchNotice}</p>}
        <div className="profile-v2-form-panel">
          <div className="profile-section-heading profile-section-heading--nested">
            <div>
              <h3>{editingSavedSearchId ? "Edit saved search" : "Add saved search"}</h3>
              <p>
                Use area slugs separated by commas, for example `all-downtown, all-midtown` or a single slug like `upper-east-side`.
              </p>
            </div>
            <div className="profile-form-actions">
              <button type="button" onClick={handleSaveSavedSearch} disabled={savingSavedSearch} className="profile-primary-button">
                {savingSavedSearch ? "Saving…" : editingSavedSearchId ? "Update search" : "Create search"}
              </button>
              <button type="button" onClick={() => handleResetSavedSearchDraft()} disabled={savingSavedSearch} className="profile-secondary-button">
                {editingSavedSearchId ? "Cancel edit" : "Reset"}
              </button>
            </div>
          </div>
          <div className="profile-form-grid">
            <label className="profile-field">
              <span>Name</span>
              <input
                type="text"
                value={savedSearchDraft.name}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Areas / slugs</span>
              <input
                type="text"
                value={savedSearchDraft.areaInput}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, areaInput: e.target.value }))}
                className="profile-input"
                placeholder={DEFAULT_SAVED_SEARCH_AREAS.join(", ")}
              />
            </label>
            <label className="profile-field">
              <span>Min price</span>
              <input
                type="number"
                value={savedSearchDraft.minPrice}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, minPrice: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Max price</span>
              <input
                type="number"
                value={savedSearchDraft.maxPrice}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, maxPrice: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Min beds</span>
              <input
                type="number"
                value={savedSearchDraft.minBeds}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, minBeds: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Max beds</span>
              <input
                type="number"
                value={savedSearchDraft.maxBeds}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, maxBeds: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Min baths</span>
              <input
                type="number"
                step="0.5"
                value={savedSearchDraft.minBaths}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, minBaths: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Max HOA</span>
              <input
                type="number"
                value={savedSearchDraft.maxHoa}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, maxHoa: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Max tax</span>
              <input
                type="number"
                value={savedSearchDraft.maxTax}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, maxTax: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Result limit</span>
              <input
                type="number"
                value={savedSearchDraft.resultLimit}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, resultLimit: e.target.value }))}
                className="profile-input"
              />
            </label>
            <label className="profile-field">
              <span>Cadence</span>
              <select
                value={savedSearchDraft.scheduleCadence}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, scheduleCadence: e.target.value as SearchCadence }))}
                className="profile-input"
              >
                <option value="manual">Manual</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="profile-field">
              <span>Timezone</span>
              <input
                type="text"
                value={savedSearchDraft.timezone}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, timezone: e.target.value }))}
                className="profile-input"
              />
            </label>
            {savedSearchDraft.scheduleCadence !== "manual" && (
              <label className="profile-field">
                <span>Run time</span>
                <input
                  type="time"
                  value={savedSearchDraft.runTimeLocal}
                  onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, runTimeLocal: e.target.value }))}
                  className="profile-input"
                />
              </label>
            )}
            {savedSearchDraft.scheduleCadence === "weekly" && (
              <label className="profile-field">
                <span>Weekly day</span>
                <select
                  value={savedSearchDraft.weeklyRunDay}
                  onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, weeklyRunDay: e.target.value }))}
                  className="profile-input"
                >
                  {SAVED_SEARCH_WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
            {savedSearchDraft.scheduleCadence === "monthly" && (
              <label className="profile-field">
                <span>Monthly day</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={savedSearchDraft.monthlyRunDay}
                  onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, monthlyRunDay: e.target.value }))}
                  className="profile-input"
                />
              </label>
            )}
            <label className="profile-field profile-field--checkbox">
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={savedSearchDraft.enabled}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
            </label>
            <label className="profile-field profile-field--full">
              <span>Amenities (comma-separated)</span>
              <input
                type="text"
                value={savedSearchDraft.amenities}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, amenities: e.target.value }))}
                className="profile-input"
                placeholder="doorman, laundry_in_unit"
              />
            </label>
            <div className="profile-field profile-field--full">
              <span>Property types</span>
              <div className="profile-checkbox-row">
                {SAVED_SEARCH_TYPE_OPTIONS.map((option) => {
                  const checked = savedSearchDraft.propertyTypes.includes(option.value);
                  return (
                    <label key={option.value} className="profile-checkbox-pill">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSavedSearchDraft((prev) => ({
                            ...prev,
                            propertyTypes: checked
                              ? prev.propertyTypes.filter((value) => value !== option.value)
                              : [...prev.propertyTypes, option.value],
                          }))
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        {savedSearchesLoading ? (
          <p className="profile-muted-copy">Loading saved searches…</p>
        ) : savedSearches.length === 0 ? (
          <p className="profile-muted-copy">No saved searches yet.</p>
        ) : filteredSavedSearches.length === 0 ? (
          <p className="profile-muted-copy">No saved searches match the current search.</p>
        ) : (
          <div className="profile-saved-search-list">
            {filteredSavedSearches.map((search) => (
              <article key={search.id} className="profile-saved-search-card">
                <div className="profile-saved-search-main">
                  <div className="profile-saved-search-header">
                    <div>
                      <h3 className="profile-saved-search-title">{search.name}</h3>
                      <p className={search.enabled ? "profile-saved-search-state profile-saved-search-state--enabled" : "profile-saved-search-state profile-saved-search-state--paused"}>
                        {search.enabled ? "Enabled" : "Paused"} · {formatSavedSearchSchedule(search)}
                      </p>
                    </div>
                    <div className="profile-saved-search-times">
                      <span><b>Next</b>{formatDateTime(search.nextRunAt)}</span>
                      <span><b>Last</b>{formatDateTime(search.lastRunAt)}</span>
                      <span><b>Success</b>{formatDateTime(search.lastSuccessAt)}</span>
                    </div>
                  </div>
                  <p className="profile-saved-search-filters">{formatSavedSearchFilters(search)}</p>
                </div>
                <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
                  <button
                    type="button"
                    onClick={() => handleEditSavedSearch(search)}
                    className="profile-saved-deals-action"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRunSavedSearchNow(search.id)}
                    disabled={runningSavedSearchId === search.id}
                    className="profile-saved-deals-action"
                  >
                    {runningSavedSearchId === search.id ? "Starting…" : "Run now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSavedSearch(search.id)}
                    disabled={deletingSavedSearchId === search.id}
                    className="profile-saved-deals-action profile-saved-deals-action--danger"
                  >
                    {deletingSavedSearchId === search.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="profile-section profile-saved-deals-section">
        <div className="profile-section-heading">
          <div>
            <h2>Saved deals</h2>
            <p className="profile-saved-deals-intro">
              Deals you saved from Pipeline. Dossier download still routes through the property view after generation.
            </p>
          </div>
          <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
            <button
              type="button"
              onClick={() => { void handleRefreshScores("saved"); }}
              disabled={refreshingScoreScope != null}
              className="profile-secondary-button"
            >
              {refreshingScoreScope === "saved" ? "Refreshing…" : "Refresh saved scores"}
            </button>
            <button
              type="button"
              onClick={() => { void handleRefreshScores("all"); }}
              disabled={refreshingScoreScope != null}
              className="profile-secondary-button"
            >
              {refreshingScoreScope === "all" ? "Refreshing…" : "Refresh all scores"}
            </button>
          </div>
        </div>
        {savedDealsLoading ? (
          <p className="profile-muted-copy">Loading saved deals…</p>
        ) : savedDeals.length === 0 ? (
          <p className="profile-muted-copy">No saved deals. Save a property from Pipeline to see it here.</p>
        ) : filteredSavedDeals.length === 0 ? (
          <p className="profile-muted-copy">No saved deals match the current search.</p>
        ) : (
          <div className="profile-saved-deals-grid">
            {filteredSavedDeals.map((row) => (
              <article key={profileSavedDealId(row)} className="profile-saved-deal-card">
                <div className="profile-saved-deal-photo" aria-hidden="true">
                  {row.imageUrl ? (
                    <img src={row.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{profileSavedDealAddress(row).slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="profile-saved-deal-body">
                  <div className="profile-saved-deal-main">
                    <h3 className="profile-saved-deal-address">{profileSavedDealAddress(row)}</h3>
                    <div className="profile-saved-deal-meta">
                      <span className={profileSavedDealStatusClass(profileSavedDealStatus(row))}>
                        {labelFromKey(profileSavedDealStatus(row))}
                      </span>
                      {profileSavedDealCreatedAt(row) ? (
                        <small>Saved {formatShortDate(profileSavedDealCreatedAt(row))}</small>
                      ) : null}
                    </div>
                    <div className="profile-saved-deal-stats">
                      <div className="profile-saved-deal-stat">
                        <span>Price</span>
                        <strong>{row.price != null ? currencyFormatter.format(row.price) : "—"}</strong>
                      </div>
                      <div className="profile-saved-deal-stat">
                        <span>Units</span>
                        <strong>{row.units != null ? String(row.units) : "—"}</strong>
                      </div>
                      <div className="profile-saved-deal-stat">
                        <span>$/SF</span>
                        <strong>{row.pricePerSqft != null ? currencyFormatter.format(row.pricePerSqft) : "—"}</strong>
                      </div>
                      <div className="profile-saved-deal-stat">
                        <span>Deal score</span>
                        <strong>
                          <span className={profileSavedDealScoreClass(row.dealScore)}>
                            {row.dealScore != null ? `${Math.round(row.dealScore)} / 100` : "—"}
                          </span>
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
                    <Link href={`/pipeline?propertyId=${profileSavedDealPropertyId(row)}`} className="profile-saved-deals-action">
                      View property
                    </Link>
                    <Link href={`/pipeline?propertyId=${profileSavedDealPropertyId(row)}`} className="profile-saved-deals-action">
                      View docs
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleUnsave(profileSavedDealPropertyId(row))}
                      className="profile-saved-deals-action profile-saved-deals-action--danger"
                    >
                      Unsave
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <style jsx global>{`
        .profile-v2.profile-page--holistic {
          max-width: none;
          padding: 0;
          gap: 1.15rem;
          color: var(--app-ink);
          font-family: var(--font-ui);
          font-variant-numeric: tabular-nums;
        }

        .profile-v2 .profile-page-header {
          align-items: flex-end;
          padding: 1.1rem 0 0.35rem;
          gap: 1.1rem;
        }

        .profile-v2 .profile-page-kicker {
          margin-bottom: 0.35rem;
          color: var(--app-muted);
          font-size: 0.74rem;
          font-weight: 780;
          letter-spacing: var(--tracking-label);
          text-transform: uppercase;
        }

        .profile-v2 .profile-page-title {
          margin: 0;
          color: var(--app-ink);
          font-size: var(--text-3xl);
          font-weight: 560;
          line-height: var(--leading-tight);
        }

        .profile-v2 .profile-page-intro {
          max-width: 44rem;
          margin-top: 0.55rem;
          color: var(--app-ink-secondary);
          font-size: 0.98rem;
          line-height: 1.55;
        }

        .profile-v2 .profile-page-summary {
          grid-template-columns: repeat(4, minmax(7.5rem, 1fr));
          min-width: min(100%, 34rem);
          gap: 0.7rem;
        }

        .profile-v2 .profile-page-summary-item {
          padding: 0.84rem 1rem;
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
          transition:
            border-color 150ms ease,
            box-shadow 150ms ease,
            transform 150ms ease;
        }

        .profile-v2 .profile-page-summary-item:hover {
          border-color: var(--app-line-strong);
          box-shadow: var(--app-shadow-md);
          transform: translateY(-1px);
        }

        .profile-v2 .profile-page-summary-item span {
          margin-bottom: 0.42rem;
          color: var(--app-muted);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .profile-v2 .profile-page-summary-item strong {
          color: var(--app-ink);
          font-size: 1.45rem;
          line-height: 1;
        }

        .profile-v2-query {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border: 1px solid var(--app-blue-border);
          border-radius: 8px;
          background: var(--app-blue-soft);
          color: var(--app-blue);
          font-size: 0.88rem;
        }

        .profile-v2-query strong {
          padding: 0.2rem 0.58rem;
          border-radius: 999px;
          background: var(--app-surface);
          color: var(--app-blue);
        }

        .profile-v2 .profile-page-error {
          border-radius: 8px;
          border: 1px solid var(--app-red-border);
          background: var(--app-red-soft);
          color: var(--app-red);
        }

        .profile-v2 .profile-section {
          padding: 1.2rem 1.3rem;
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow-md);
        }

        .profile-v2 .profile-section-heading {
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.1rem;
        }

        .profile-v2 .profile-section-heading h2 {
          margin-bottom: 0.25rem;
          color: var(--app-ink);
          font-size: 1.05rem;
          font-weight: 760;
        }

        .profile-v2 .profile-section-heading h3 {
          margin: 0;
          color: var(--app-ink);
          font-size: 0.98rem;
          font-weight: 760;
        }

        .profile-v2 .profile-section-heading p,
        .profile-v2 .profile-section-note {
          color: var(--app-muted);
          font-size: 0.88rem;
          line-height: 1.52;
        }

        .profile-v2 .profile-form-grid {
          gap: 0.95rem 1rem;
        }

        .profile-v2 .profile-field {
          gap: 0.45rem;
          min-width: 0;
        }

        .profile-v2 .profile-field--full {
          grid-column: 1 / -1;
        }

        .profile-v2 .profile-field--checkbox {
          justify-content: end;
          min-height: 4.2rem;
        }

        .profile-v2 .profile-field--checkbox input[type="checkbox"] {
          margin-top: 0.25rem;
        }

        .profile-v2 .profile-field span {
          color: var(--app-ink-secondary);
          font-size: 0.78rem;
          font-weight: 780;
          line-height: 1.25;
        }

        .profile-v2 .profile-input {
          min-height: 2.55rem;
          padding: 0.64rem 0.9rem;
          border: 1px solid var(--app-line-strong);
          border-radius: 8px;
          background: linear-gradient(180deg, #ffffff 0%, var(--app-surface-raised) 100%);
          color: var(--app-ink);
          box-shadow: var(--app-control-shadow);
          font-size: 0.94rem;
          line-height: 1.25;
        }

        .profile-v2 .profile-input:focus {
          border-color: var(--brand-border);
          background: var(--app-surface);
          box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12), var(--app-control-shadow);
        }

        .profile-v2 input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          accent-color: var(--brand);
        }

        .profile-v2 .profile-primary-button,
        .profile-v2 .profile-secondary-button,
        .profile-v2 .profile-saved-deals-action {
          min-height: 2rem;
          padding: 0.42rem 0.8rem;
          border-radius: 7px;
          font-size: 0.82rem;
          font-weight: 750;
          line-height: 1.1;
          white-space: nowrap;
          box-shadow: var(--app-control-shadow);
          transition:
            background 150ms ease,
            border-color 150ms ease,
            color 150ms ease,
            transform 150ms ease;
        }

        .profile-v2 .profile-primary-button {
          border-color: var(--brand);
          background: var(--brand);
          color: var(--brand-on);
        }

        .profile-v2 .profile-secondary-button {
          border-color: var(--app-line-strong);
          background: var(--app-surface);
          color: var(--brand-strong);
        }

        .profile-v2 .profile-primary-button:hover,
        .profile-v2 .profile-secondary-button:hover,
        .profile-v2 .profile-saved-deals-action:hover {
          transform: translateY(-1px);
        }

        .profile-v2 .profile-section-note--callout,
        .profile-v2-form-panel {
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface-raised);
        }

        .profile-v2 .profile-section-note--callout {
          padding: 0.85rem 1rem;
          border-left: 3px solid var(--brand);
        }

        .profile-v2-form-panel {
          margin-bottom: 1.05rem;
          padding: 1.15rem 1.25rem;
        }

        .profile-v2 .profile-assumption-groups {
          gap: 0.95rem;
        }

        .profile-v2 .profile-assumption-group {
          padding: 1.1rem 1.2rem;
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
        }

        .profile-v2 .profile-assumption-group--scoring {
          margin-top: 1rem;
        }

        .profile-v2 .profile-assumption-group-header h3,
        .profile-v2 .profile-saved-deal-address {
          color: var(--app-ink);
        }

        .profile-v2 .profile-assumption-group-header p {
          color: var(--app-muted);
          font-size: 0.84rem;
          line-height: 1.5;
        }

        .profile-v2 .profile-assumptions-toolbar {
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid var(--app-line);
        }

        .profile-v2 .profile-assumptions-toolbar span {
          color: var(--app-ink-secondary);
          font-size: 0.88rem;
        }

        .profile-v2 .profile-saved-deals-grid {
          grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
          gap: 0.85rem;
        }

        .profile-v2 .profile-saved-deal-card {
          overflow: hidden;
          padding: 0;
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
          transition:
            border-color 150ms ease,
            box-shadow 150ms ease,
            transform 150ms ease;
        }

        .profile-v2 .profile-saved-deal-card:hover {
          border-color: var(--app-line-strong);
          box-shadow: var(--app-shadow-md);
          transform: translateY(-1px);
        }

        .profile-v2 .profile-saved-deal-photo {
          display: grid;
          width: 100%;
          aspect-ratio: 16 / 9;
          place-items: center;
          overflow: hidden;
          background: linear-gradient(135deg, var(--brand-soft), var(--app-surface-raised));
          color: var(--brand-strong);
        }

        .profile-v2 .profile-saved-deals-grid .profile-saved-deal-photo {
          aspect-ratio: 5 / 3;
        }

        .profile-v2 .profile-saved-deal-photo img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .profile-v2 .profile-saved-deal-photo span {
          display: grid;
          width: 3.2rem;
          height: 3.2rem;
          place-items: center;
          border: 1px solid var(--brand-border);
          border-radius: 999px;
          background: var(--app-surface);
          color: var(--brand-strong);
          font-size: 1.45rem;
          font-weight: 850;
        }

        .profile-v2 .profile-saved-deal-body {
          display: grid;
          gap: 0.82rem;
          padding: 1rem 1.05rem;
        }

        .profile-v2 .profile-saved-deal-main {
          gap: 0.65rem;
        }

        .profile-v2 .profile-saved-deal-meta {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
        }

        .profile-v2 .profile-saved-deal-meta small {
          color: var(--app-muted);
          font-size: 0.78rem;
          font-weight: 650;
        }

        .profile-v2 .profile-mini-status {
          display: inline-flex;
          align-items: center;
          min-height: 1.35rem;
          padding: 0.18rem 0.58rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 800;
          line-height: 1;
        }

        .profile-v2 .profile-mini-status--neutral {
          border: 1px solid var(--app-line);
          background: var(--app-surface-strong);
          color: var(--app-ink-secondary);
        }

        .profile-v2 .profile-mini-status--info {
          border: 1px solid var(--app-blue-border);
          background: var(--app-blue-soft);
          color: var(--app-blue);
        }

        .profile-v2 .profile-mini-status--success {
          border: 1px solid var(--app-green-border);
          background: var(--app-green-soft);
          color: var(--app-green);
        }

        .profile-v2 .profile-mini-status--warning {
          border: 1px solid var(--app-amber-border);
          background: var(--app-amber-soft);
          color: var(--app-amber);
        }

        .profile-v2 .profile-mini-status--danger {
          border: 1px solid var(--app-red-border);
          background: var(--app-red-soft);
          color: var(--app-red);
        }

        .profile-v2 .profile-saved-deal-stat span {
          color: var(--app-muted);
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .profile-v2 .profile-saved-deals-action {
          flex: 0 0 auto;
          border-color: var(--app-line-strong);
          background: var(--app-surface);
          color: var(--brand-strong);
          padding: 0.36rem 0.68rem;
        }

        .profile-v2 .profile-saved-deals-action--danger {
          border-color: var(--app-red-border);
          background: var(--app-red-soft);
          color: var(--app-red);
        }

        .profile-v2 .profile-saved-deals-actions--row {
          flex-wrap: wrap;
          overflow: visible;
          gap: 0.45rem;
        }

        .profile-v2 .profile-saved-deals-score {
          min-width: 4.75rem;
          border: 1px solid var(--app-line);
          background: var(--app-surface-strong);
          color: var(--app-muted);
          font-size: 0.76rem;
          font-weight: 850;
        }

        .profile-section-heading--nested {
          margin-bottom: 1.05rem;
        }

        .profile-form-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem;
          justify-content: flex-end;
        }

        .profile-checkbox-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
          margin-top: 0.25rem;
        }

        .profile-checkbox-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          min-height: 1.9rem;
          padding: 0.34rem 0.62rem;
          border: 1px solid var(--app-line);
          border-radius: 999px;
          background: var(--app-surface);
          color: var(--app-ink-secondary);
          font-size: 0.82rem;
          font-weight: 720;
          box-shadow: var(--app-control-shadow);
        }

        .profile-muted-copy,
        .profile-page-message {
          margin: 0.1rem 0 1rem;
          color: var(--app-muted);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .profile-page-success {
          padding: 0.75rem 1rem;
          border: 1px solid var(--app-green-border);
          border-radius: 8px;
          background: var(--app-green-soft);
          color: var(--app-green);
          font-weight: 650;
        }

        .profile-saved-search-list {
          display: grid;
          gap: 0.85rem;
        }

        .profile-saved-search-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 1rem;
          align-items: start;
          padding: 1rem 1.1rem;
          border: 1px solid var(--app-line);
          border-radius: 8px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
          transition:
            border-color 150ms ease,
            box-shadow 150ms ease,
            transform 150ms ease;
        }

        .profile-saved-search-card:hover {
          border-color: var(--app-line-strong);
          box-shadow: var(--app-shadow-md);
          transform: translateY(-1px);
        }

        .profile-saved-search-main {
          display: grid;
          gap: 0.82rem;
          min-width: 0;
        }

        .profile-saved-search-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
        }

        .profile-saved-search-title {
          margin: 0;
          color: var(--app-ink);
          font-size: 1rem;
          font-weight: 760;
          line-height: 1.25;
        }

        .profile-saved-search-state {
          margin: 0.35rem 0 0;
          font-size: 0.84rem;
          font-weight: 760;
        }

        .profile-saved-search-state--enabled {
          color: var(--app-green);
        }

        .profile-saved-search-state--paused {
          color: var(--app-amber);
        }

        .profile-saved-search-times {
          display: grid;
          gap: 0.3rem;
          min-width: 13rem;
          color: var(--app-ink-secondary);
          font-size: 0.8rem;
          line-height: 1.25;
          text-align: right;
        }

        .profile-saved-search-times span {
          display: flex;
          justify-content: flex-end;
          gap: 0.35rem;
        }

        .profile-saved-search-times b {
          color: var(--app-muted);
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .profile-saved-search-filters {
          margin: 0;
          padding-top: 0.8rem;
          border-top: 1px solid var(--app-line-subtle);
          color: var(--app-ink-secondary);
          font-size: 0.9rem;
          line-height: 1.55;
        }

        .profile-v2 .profile-saved-deals-score--strong {
          border-color: var(--app-green-border);
          background: var(--app-green-soft);
          color: var(--app-green);
        }

        .profile-v2 .profile-saved-deals-score--watch {
          border-color: var(--app-amber-border);
          background: var(--app-amber-soft);
          color: var(--app-amber);
        }

        .profile-v2 .profile-saved-deals-score--weak {
          border-color: var(--app-red-border);
          background: var(--app-red-soft);
          color: var(--app-red);
        }

        .profile-v2 .profile-saved-deals-score--empty {
          border-color: var(--app-line);
          background: var(--app-surface-strong);
          color: var(--app-muted);
        }

        @media (max-width: 980px) {
          .profile-v2 .profile-page-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .profile-v2 .profile-page-summary {
            width: 100%;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .profile-v2 .profile-assumption-groups {
            grid-template-columns: 1fr;
          }

          .profile-saved-search-card {
            grid-template-columns: 1fr;
          }

          .profile-saved-search-header {
            flex-direction: column;
          }

          .profile-saved-search-times {
            width: 100%;
            min-width: 0;
            text-align: left;
          }

          .profile-saved-search-times span {
            justify-content: flex-start;
          }
        }

        @media (max-width: 640px) {
          .profile-v2 .profile-section-heading {
            align-items: flex-start;
            flex-direction: column;
          }

          .profile-v2 .profile-page-summary {
            grid-template-columns: 1fr;
          }

          .profile-v2 .profile-saved-deal-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="profile-page--holistic">Loading profile...</div>}>
      <ProfilePageContent />
    </Suspense>
  );
}
