"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

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
      { key: "defaultAnnualRentGrowthPct", label: "Annual rent growth (%)", step: "0.1" },
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
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
  createdAt: string;
  updatedAt: string;
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

function formatSavedSearchAreas(search: SavedSearch): string {
  if (search.locationMode === "single" && search.singleLocationSlug) return search.singleLocationSlug;
  if (search.areaCodes.length > 0) return search.areaCodes.join(", ");
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
  if (search.propertyTypes.length > 0) filters.push(`Types: ${search.propertyTypes.join(", ")}`);
  if (search.requiredAmenities.length > 0) filters.push(`Amenities: ${search.requiredAmenities.join(", ")}`);
  if (search.resultLimit != null) filters.push(`Limit: ${search.resultLimit}`);
  return filters.join(" | ");
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

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<UserProfile>>({});
  const [currentSitePassword, setCurrentSitePassword] = useState("");
  const [nextSitePassword, setNextSitePassword] = useState("");
  const [confirmSitePassword, setConfirmSitePassword] = useState("");
  const [sitePasswordSaving, setSitePasswordSaving] = useState(false);
  const [sitePasswordError, setSitePasswordError] = useState<string | null>(null);
  const [sitePasswordNotice, setSitePasswordNotice] = useState<string | null>(null);
  const [savedDeals, setSavedDeals] = useState<Array<{ savedDeal: { id: string; propertyId: string; dealStatus: string; createdAt: string }; address: string; price: number | null; units: number | null; dealScore: number | null }>>([]);
  const [savedDealsLoading, setSavedDealsLoading] = useState(false);
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
        defaultAnnualOtherIncomeGrowthPct: data.defaultAnnualOtherIncomeGrowthPct ?? 0,
        defaultAnnualExpenseGrowthPct: data.defaultAnnualExpenseGrowthPct ?? 0,
        defaultAnnualPropertyTaxGrowthPct: data.defaultAnnualPropertyTaxGrowthPct ?? 6,
        defaultRecurringCapexAnnual: data.defaultRecurringCapexAnnual ?? 1200,
        defaultLoanFeePct: data.defaultLoanFeePct ?? 0.63,
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
          defaultAnnualOtherIncomeGrowthPct:
            draft.defaultAnnualOtherIncomeGrowthPct ?? profile.defaultAnnualOtherIncomeGrowthPct,
          defaultAnnualExpenseGrowthPct:
            draft.defaultAnnualExpenseGrowthPct ?? profile.defaultAnnualExpenseGrowthPct,
          defaultAnnualPropertyTaxGrowthPct:
            draft.defaultAnnualPropertyTaxGrowthPct ?? profile.defaultAnnualPropertyTaxGrowthPct,
          defaultRecurringCapexAnnual:
            draft.defaultRecurringCapexAnnual ?? profile.defaultRecurringCapexAnnual,
          defaultLoanFeePct: draft.defaultLoanFeePct ?? profile.defaultLoanFeePct,
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

  const handleChangeSitePassword = async () => {
    setSitePasswordError(null);
    setSitePasswordNotice(null);

    if (!currentSitePassword.trim()) {
      setSitePasswordError("Enter the current site password.");
      return;
    }
    if (!nextSitePassword.trim()) {
      setSitePasswordError("Enter a new site password.");
      return;
    }
    if (nextSitePassword.trim().length < 8) {
      setSitePasswordError("New password must be at least 8 characters.");
      return;
    }
    if (nextSitePassword !== confirmSitePassword) {
      setSitePasswordError("New password and confirmation do not match.");
      return;
    }

    setSitePasswordSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentSitePassword,
          newSitePassword: nextSitePassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to update site password");
      setProfile(data);
      setCurrentSitePassword("");
      setNextSitePassword("");
      setConfirmSitePassword("");
      setSitePasswordNotice("Site password updated. Use the new password the next time you unlock the workspace.");
    } catch (e) {
      setSitePasswordError(e instanceof Error ? e.message : "Failed to update site password");
    } finally {
      setSitePasswordSaving(false);
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
      setSavedDeals((prev) => prev.filter((r) => r.savedDeal.propertyId !== propertyId));
    } catch {
      // ignore
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
        setSavedSearchNotice("Saved search is already running. Open Property Data for live workflow tracking while the current run finishes.");
        await fetchSavedSearches();
        return;
      }
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start saved search");
      setSavedSearchNotice("Saved search started. Open Property Data for live workflow tracking.");
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

  if (loading) {
    return (
      <div className="profile-page" style={{ padding: "1.5rem" }}>
        <h1 className="page-title">Profile</h1>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="profile-page profile-page--holistic">
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
        </div>
      </header>
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
            <h2>Site password</h2>
            <p>Rotate the single shared password that unlocks the entire workspace.</p>
          </div>
          <button
            type="button"
            onClick={handleChangeSitePassword}
            disabled={sitePasswordSaving}
            className="profile-primary-button"
          >
            {sitePasswordSaving ? "Updating…" : "Update password"}
          </button>
        </div>
        <p className="profile-section-note">
          This changes the global unlock password for the whole site. You will need the current shared password to rotate it.
        </p>
        {sitePasswordError && <p className="profile-page-error">{sitePasswordError}</p>}
        {sitePasswordNotice && <p style={{ margin: 0, color: "#166534" }}>{sitePasswordNotice}</p>}
        <div className="profile-form-grid profile-form-grid--compact">
          <label className="profile-field">
            <span>Current password</span>
            <input
              type="password"
              value={currentSitePassword}
              onChange={(e) => {
                setCurrentSitePassword(e.target.value);
                setSitePasswordError(null);
                setSitePasswordNotice(null);
              }}
              className="profile-input"
              autoComplete="current-password"
            />
          </label>
          <label className="profile-field">
            <span>New password</span>
            <input
              type="password"
              value={nextSitePassword}
              onChange={(e) => {
                setNextSitePassword(e.target.value);
                setSitePasswordError(null);
                setSitePasswordNotice(null);
              }}
              className="profile-input"
              autoComplete="new-password"
            />
          </label>
          <label className="profile-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmSitePassword}
              onChange={(e) => {
                setConfirmSitePassword(e.target.value);
                setSitePasswordError(null);
                setSitePasswordNotice(null);
              }}
              className="profile-input"
              autoComplete="new-password"
            />
          </label>
        </div>
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
        {savedSearchError && <p className="profile-page-error" style={{ marginTop: 0 }}>{savedSearchError}</p>}
        {savedSearchNotice && <p style={{ marginTop: 0, color: "#166534" }}>{savedSearchNotice}</p>}
        <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: "1rem", background: "#fafaf9", marginBottom: "1rem" }}>
          <div className="profile-section-heading" style={{ marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>{editingSavedSearchId ? "Edit saved search" : "Add saved search"}</h3>
              <p style={{ margin: "0.35rem 0 0", color: "#57534e" }}>
                Use area slugs separated by commas, for example `all-downtown, all-midtown` or a single slug like `upper-east-side`.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
            <label className="profile-field" style={{ justifyContent: "center" }}>
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={savedSearchDraft.enabled}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: "1rem", height: "1rem", marginTop: "0.5rem" }}
              />
            </label>
            <label className="profile-field" style={{ gridColumn: "1 / -1" }}>
              <span>Amenities (comma-separated)</span>
              <input
                type="text"
                value={savedSearchDraft.amenities}
                onChange={(e) => setSavedSearchDraft((prev) => ({ ...prev, amenities: e.target.value }))}
                className="profile-input"
                placeholder="doorman, laundry_in_unit"
              />
            </label>
            <div className="profile-field" style={{ gridColumn: "1 / -1" }}>
              <span>Property types</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.45rem" }}>
                {SAVED_SEARCH_TYPE_OPTIONS.map((option) => {
                  const checked = savedSearchDraft.propertyTypes.includes(option.value);
                  return (
                    <label key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
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
          <p>Loading saved searches…</p>
        ) : savedSearches.length === 0 ? (
          <p style={{ color: "#737373" }}>No saved searches yet. Add one above to start daily automated ingestion.</p>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {savedSearches.map((search) => (
              <article key={search.id} className="profile-saved-deal-card">
                <div className="profile-saved-deal-main">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div>
                      <h3 className="profile-saved-deal-address" style={{ marginBottom: "0.35rem" }}>{search.name}</h3>
                      <p style={{ margin: 0, color: search.enabled ? "#166534" : "#a16207", fontWeight: 600 }}>
                        {search.enabled ? "Enabled" : "Paused"} · {formatSavedSearchSchedule(search)}
                      </p>
                    </div>
                    <div style={{ display: "grid", gap: "0.2rem", fontSize: "0.9rem", color: "#57534e", textAlign: "right" }}>
                      <span>Next run: {formatDateTime(search.nextRunAt)}</span>
                      <span>Last run: {formatDateTime(search.lastRunAt)}</span>
                      <span>Last success: {formatDateTime(search.lastSuccessAt)}</span>
                    </div>
                  </div>
                  <p style={{ margin: "0.85rem 0 0", color: "#44403c", lineHeight: 1.5 }}>{formatSavedSearchFilters(search)}</p>
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
              Deals you saved from Property Data. Dossier download still routes through the property view after generation.
            </p>
          </div>
        </div>
        {savedDealsLoading ? (
          <p>Loading saved deals…</p>
        ) : savedDeals.length === 0 ? (
          <p style={{ color: "#737373" }}>No saved deals. Use the star on a property in Property Data to save.</p>
        ) : (
          <div className="profile-saved-deals-grid">
            {savedDeals.map((row) => (
              <article key={row.savedDeal.id} className="profile-saved-deal-card">
                <div className="profile-saved-deal-main">
                  <h3 className="profile-saved-deal-address">{row.address || "—"}</h3>
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
                      <span>Deal score</span>
                      <strong>{row.dealScore != null ? <span className="profile-saved-deals-score">{Math.round(row.dealScore)}</span> : "—"}</strong>
                    </div>
                  </div>
                </div>
                <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
                  <Link href={`/property-data?expand=${row.savedDeal.propertyId}`} className="profile-saved-deals-action">
                    View property
                  </Link>
                  <Link href={`/property-data?expand=${row.savedDeal.propertyId}#documents`} className="profile-saved-deals-action">
                    Download dossier
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleUnsave(row.savedDeal.propertyId)}
                    className="profile-saved-deals-action profile-saved-deals-action--danger"
                  >
                    Unsave
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
