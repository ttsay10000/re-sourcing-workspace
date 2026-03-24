"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

type SummaryMode = "combined" | "neighborhood";

interface SalesDataset {
  id: string;
  name: string;
  title: string | null;
  originalFileName: string;
  sourceKind: "uploaded" | "seeded";
  importedAt: string;
  recordCount: number;
  pricedSaleCount: number;
  ppsfSaleCount: number;
  totalSaleVolume: number;
  saleDateMin: string | null;
  saleDateMax: string | null;
}

interface SalesSummary {
  saleCount: number;
  ppsfSaleCount: number;
  totalSaleVolume: number;
  averageSalePrice: number | null;
  medianSalePrice: number | null;
  averagePricePerGrossSquareFoot: number | null;
  medianPricePerGrossSquareFoot: number | null;
  averageGrossSquareFeet: number | null;
  medianGrossSquareFeet: number | null;
  averageUnits: number | null;
  medianUnits: number | null;
  saleDateMin: string | null;
  saleDateMax: string | null;
}

interface SalesGroupRow extends SalesSummary {
  key: string;
  label: string;
}

interface SalesTrendNeighborhoodRow {
  neighborhood: string;
  summary: SalesSummary;
}

interface SalesTrendRow {
  bucketKey: string;
  bucketLabel: string;
  summary: SalesSummary;
  neighborhoods: SalesTrendNeighborhoodRow[];
}

interface SalesTransaction {
  id: string;
  datasetId: string;
  datasetName: string;
  neighborhood: string | null;
  buildingClassCategory: string | null;
  taxClassAtPresent: string | null;
  address: string | null;
  apartmentNumber: string | null;
  totalUnits: number | null;
  grossSquareFeet: number | null;
  salePrice: number | null;
  saleDate: string | null;
  pricePerGrossSquareFoot: number | null;
}

interface SalesQueryResponse {
  filters: {
    neighborhoods: string[];
    buildingClassCategories: string[];
    taxClasses: string[];
    unitsRange: { min: number | null; max: number | null };
    grossSquareFeetRange: { min: number | null; max: number | null };
    salePriceRange: { min: number | null; max: number | null };
  };
  totals: {
    datasetCount: number;
    matchedSales: number;
    shownTransactions: number;
  };
  summary: SalesSummary;
  datasetTable: SalesGroupRow[];
  neighborhoodTable: SalesGroupRow[];
  buildingClassTable: SalesGroupRow[];
  comparisonNeighborhoods: string[];
  trendRows: SalesTrendRow[];
  transactions: SalesTransaction[];
}

interface FilterDraft {
  neighborhoods: string[];
  buildingClassCategory: string;
  taxClass: string;
  minUnits: string;
  maxUnits: string;
  minGrossSquareFeet: string;
  maxGrossSquareFeet: string;
  minPrice: string;
  maxPrice: string;
}

interface NoticeState {
  type: "success" | "error";
  text: string;
}

const DEFAULT_FILTERS: FilterDraft = {
  neighborhoods: [],
  buildingClassCategory: "",
  taxClass: "",
  minUnits: "",
  maxUnits: "",
  minGrossSquareFeet: "",
  maxGrossSquareFeet: "",
  minPrice: "",
  maxPrice: "",
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return currencyFormatter.format(value);
}

function formatWholeNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return integerFormatter.format(Math.round(value));
}

function formatPpsf(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${currencyFormatter.format(Math.round(value))}/SF`;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "No sale dates";
  if (start && end && start === end) return formatShortDate(start);
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function parseOptionalNumber(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function composeAddress(transaction: SalesTransaction): string {
  if (!transaction.address && !transaction.apartmentNumber) return "—";
  if (!transaction.apartmentNumber) return transaction.address ?? "—";
  return `${transaction.address ?? ""} ${transaction.apartmentNumber}`.trim();
}

function summarizeNeighborhoodSelection(selected: string[]): string {
  if (selected.length === 0) return "All neighborhoods";
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.slice(0, 2).join(", ")} +${selected.length - 2}`;
}

function GroupTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: SalesGroupRow[];
}) {
  return (
    <section className="sales-metrics-table-card">
      <div className="sales-metrics-section-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="sales-metrics-table-wrap">
        <table className="sales-metrics-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Sales</th>
              <th>Median PPSF</th>
              <th>Avg PPSF</th>
              <th>Median Price</th>
              <th>Total Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="sales-metrics-empty-row">
                  No matching sales.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <div className="sales-metrics-row-title">{row.label}</div>
                    <div className="sales-metrics-row-subtle">{formatDateRange(row.saleDateMin, row.saleDateMax)}</div>
                  </td>
                  <td>{formatWholeNumber(row.saleCount)}</td>
                  <td>{formatPpsf(row.medianPricePerGrossSquareFoot)}</td>
                  <td>{formatPpsf(row.averagePricePerGrossSquareFoot)}</td>
                  <td>{formatCurrency(row.medianSalePrice)}</td>
                  <td>{formatCurrency(row.totalSaleVolume)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NeighborhoodMultiSelect({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: string[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const visibleOptions = options.filter((option) =>
    option.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="sales-metrics-field">
      <span>Neighborhoods</span>
      <div className="sales-metrics-multiselect" ref={rootRef}>
        <button
          type="button"
          className="sales-metrics-multiselect-trigger"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
        >
          <span>{summarizeNeighborhoodSelection(selected)}</span>
          <span className={`sales-metrics-multiselect-chevron ${open ? "sales-metrics-multiselect-chevron--open" : ""}`}>
            ▼
          </span>
        </button>
        {open ? (
          <div className="sales-metrics-multiselect-panel">
            <input
              type="text"
              value={search}
              placeholder="Search neighborhoods"
              onChange={(event) => setSearch(event.target.value)}
              className="sales-metrics-multiselect-search"
            />
            <div className="sales-metrics-multiselect-actions">
              <button type="button" onClick={() => onChange(options)}>
                Select all
              </button>
              <button type="button" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
            <div className="sales-metrics-multiselect-meta">
              {selected.length} selected
              {search.trim() ? ` · ${visibleOptions.length} match search` : ""}
            </div>
            <div className="sales-metrics-multiselect-options">
              {visibleOptions.length === 0 ? (
                <div className="sales-metrics-multiselect-empty">No neighborhoods match.</div>
              ) : (
                visibleOptions.map((option) => {
                  const checked = selected.includes(option);
                  return (
                    <label key={option} className="sales-metrics-multiselect-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onChange(
                            checked
                              ? selected.filter((value) => value !== option)
                              : [...selected, option]
                          )
                        }
                      />
                      <span>{option}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TrendComparisonTable({
  rows,
  comparisonNeighborhoods,
}: {
  rows: SalesTrendRow[];
  comparisonNeighborhoods: string[];
}) {
  return (
    <section className="sales-metrics-table-card">
      <div className="sales-metrics-section-header">
        <div>
          <h2>Quarterly PPSF trend comparison</h2>
          <p>
            Compare how median PPSF moves over time across the selected neighborhoods, while keeping the
            same unit, square-footage, price, class, and tax filters.
          </p>
        </div>
      </div>
      <div className="sales-metrics-table-wrap">
        <table className="sales-metrics-table sales-metrics-table--trend">
          <thead>
            <tr>
              <th>Period</th>
              <th>All selected sales</th>
              {comparisonNeighborhoods.map((neighborhood) => (
                <th key={neighborhood}>{neighborhood}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={comparisonNeighborhoods.length + 2} className="sales-metrics-empty-row">
                  No quarterly trend rows match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.bucketKey}>
                  <td>
                    <div className="sales-metrics-row-title">{row.bucketLabel}</div>
                    <div className="sales-metrics-row-subtle">{formatDateRange(row.summary.saleDateMin, row.summary.saleDateMax)}</div>
                  </td>
                  <td>
                    <div className="sales-metrics-trend-value">{formatPpsf(row.summary.medianPricePerGrossSquareFoot)}</div>
                    <div className="sales-metrics-row-subtle">
                      {formatWholeNumber(row.summary.saleCount)} sales · {formatCurrency(row.summary.totalSaleVolume)}
                    </div>
                  </td>
                  {comparisonNeighborhoods.map((neighborhood) => {
                    const match = row.neighborhoods.find((entry) => entry.neighborhood === neighborhood);
                    const summary = match?.summary;
                    return (
                      <td key={`${row.bucketKey}-${neighborhood}`}>
                        <div className="sales-metrics-trend-value">
                          {formatPpsf(summary?.medianPricePerGrossSquareFoot)}
                        </div>
                        <div className="sales-metrics-row-subtle">
                          {formatWholeNumber(summary?.saleCount)} sales · {formatCurrency(summary?.medianSalePrice)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SalesMetricsPage() {
  const [datasets, setDatasets] = useState<SalesDataset[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterDraft>(DEFAULT_FILTERS);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("combined");
  const [queryData, setQueryData] = useState<SalesQueryResponse | null>(null);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const selectionInitializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;

    async function loadDatasets() {
      setLoadingDatasets(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/sales-metrics/datasets`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);
        if (cancelled) return;
        setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load stored sales datasets.");
        setDatasets([]);
      } finally {
        if (!cancelled) setLoadingDatasets(false);
      }
    }

    void loadDatasets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const availableIds = new Set(datasets.map((dataset) => dataset.id));
    if (datasets.length === 0) {
      setSelectedDatasetIds([]);
      selectionInitializedRef.current = false;
      return;
    }

    if (!selectionInitializedRef.current) {
      selectionInitializedRef.current = true;
      setSelectedDatasetIds(datasets.map((dataset) => dataset.id));
      return;
    }

    setSelectedDatasetIds((current) => current.filter((id) => availableIds.has(id)));
  }, [datasets]);

  useEffect(() => {
    if (datasets.length === 0 || selectedDatasetIds.length === 0) {
      setQueryData(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoadingQuery(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("datasetIds", selectedDatasetIds.join(","));
        if (filters.neighborhoods.length > 0) {
          params.set("neighborhoods", filters.neighborhoods.join(","));
        }

        const fields: Array<[Exclude<keyof FilterDraft, "neighborhoods">, string]> = [
          ["buildingClassCategory", filters.buildingClassCategory],
          ["taxClass", filters.taxClass],
          ["minUnits", filters.minUnits],
          ["maxUnits", filters.maxUnits],
          ["minGrossSquareFeet", filters.minGrossSquareFeet],
          ["maxGrossSquareFeet", filters.maxGrossSquareFeet],
          ["minPrice", filters.minPrice],
          ["maxPrice", filters.maxPrice],
        ];

        for (const [key, value] of fields) {
          const parsed = parseOptionalNumber(value);
          if (parsed) params.set(key, parsed);
        }

        const response = await fetch(`${API_BASE}/api/sales-metrics/query?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);
        setQueryData(data as SalesQueryResponse);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load filtered sales metrics.");
        setQueryData(null);
      } finally {
        if (!controller.signal.aborted) setLoadingQuery(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [datasets.length, filters, selectedDatasetIds]);

  async function refreshDatasets(options?: { preserveSelection?: boolean; appendSelectionIds?: string[] }) {
    const response = await fetch(`${API_BASE}/api/sales-metrics/datasets`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);
    const nextDatasets = Array.isArray(data.datasets) ? (data.datasets as SalesDataset[]) : [];
    setDatasets(nextDatasets);

    if (options?.appendSelectionIds?.length) {
      setSelectedDatasetIds((current) => {
        const availableIds = new Set(nextDatasets.map((dataset) => dataset.id));
        const merged = Array.from(new Set([...current, ...options.appendSelectionIds!]));
        return merged.filter((id) => availableIds.has(id));
      });
      selectionInitializedRef.current = true;
      return;
    }

    if (options?.preserveSelection) {
      const availableIds = new Set(nextDatasets.map((dataset) => dataset.id));
      setSelectedDatasetIds((current) => current.filter((id) => availableIds.has(id)));
    }
  }

  async function handleUpload() {
    if (pendingFiles.length === 0) {
      setNotice({ type: "error", text: "Choose one or more `.xlsx`, `.xls`, or `.csv` files first." });
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      pendingFiles.forEach((file) => formData.append("files", file));

      const response = await fetch(`${API_BASE}/api/sales-metrics/datasets/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);

      const importedDatasets = Array.isArray(data.imported) ? (data.imported as SalesDataset[]) : [];
      const failures = Array.isArray(data.failed) ? data.failed.length : 0;
      await refreshDatasets({ appendSelectionIds: importedDatasets.map((dataset) => dataset.id) });
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (importedDatasets.length > 0) {
        setNotice({
          type: failures > 0 ? "error" : "success",
          text:
            failures > 0
              ? `Imported ${importedDatasets.length} dataset${importedDatasets.length === 1 ? "" : "s"} and ${failures} file${failures === 1 ? "" : "s"} failed.`
              : `Imported ${importedDatasets.length} dataset${importedDatasets.length === 1 ? "" : "s"}.`,
        });
      } else {
        setNotice({ type: "error", text: "No datasets were imported." });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import the selected sales datasets.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDataset(dataset: SalesDataset) {
    const shouldDelete = window.confirm(`Remove ${dataset.name}? This deletes the stored dataset from the workspace.`);
    if (!shouldDelete) return;

    setDeletingDatasetId(dataset.id);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sales-metrics/datasets/${encodeURIComponent(dataset.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);
      await refreshDatasets({ preserveSelection: true });
      setNotice({ type: "success", text: `Removed ${dataset.name}.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the selected dataset.");
    } finally {
      setDeletingDatasetId(null);
    }
  }

  const summaryNeighborhoodRows =
    filters.neighborhoods.length > 0
      ? filters.neighborhoods.flatMap((neighborhood) => {
          const match = queryData?.neighborhoodTable.find((row) => row.label === neighborhood);
          return match ? [match] : [];
        })
      : (queryData?.neighborhoodTable ?? []).slice(0, 6);
  const comparisonNeighborhoods = queryData?.comparisonNeighborhoods ?? [];
  const showingNeighborhoodComparison = comparisonNeighborhoods.length > 0;

  return (
    <div className="sales-metrics-page">
      <section className="sales-metrics-hero">
        <div>
          <p className="sales-metrics-kicker">Sales metrics</p>
          <h1>Filter Manhattan sales and compare price per square foot trends across neighborhoods.</h1>
          <p className="sales-metrics-lede">
            Load rolling or annual sales files, keep the datasets you care about, and compare selected
            neighborhoods side by side by PPSF, sale price, volume, units, and time period.
          </p>
        </div>
        <div className="sales-metrics-upload-card">
          <label className="sales-metrics-upload-label" htmlFor="sales-dataset-upload">
            Import datasets
          </label>
          <input
            id="sales-dataset-upload"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []))}
          />
          <p className="sales-metrics-upload-hint">
            Upload NYC rolling sales or annual sales files. Imported datasets stay stored until you remove them.
          </p>
          <div className="sales-metrics-upload-actions">
            <button
              type="button"
              className="sales-metrics-primary-button"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? "Importing…" : "Import selected files"}
            </button>
            <span className="sales-metrics-upload-selection">
              {pendingFiles.length === 0
                ? "No files selected"
                : `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} ready`}
            </span>
          </div>
        </div>
      </section>

      {notice ? (
        <div className={`sales-metrics-notice sales-metrics-notice--${notice.type}`}>{notice.text}</div>
      ) : null}
      {error ? <div className="sales-metrics-error">{error}</div> : null}

      <section className="sales-metrics-panel">
        <div className="sales-metrics-section-header">
          <div>
            <h2>Stored datasets</h2>
            <p>Toggle which files feed the analysis. Removing a dataset deletes it from this workspace.</p>
          </div>
          <div className="sales-metrics-section-badge">
            {loadingDatasets ? "Loading…" : `${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {datasets.length === 0 && !loadingDatasets ? (
          <div className="sales-metrics-empty-state">
            <h3>No sales datasets yet</h3>
            <p>Import the annual or rolling Manhattan spreadsheets above to start building filtered PPSF views.</p>
          </div>
        ) : (
          <div className="sales-metrics-dataset-grid">
            {datasets.map((dataset) => {
              const selected = selectedDatasetIds.includes(dataset.id);
              return (
                <article
                  key={dataset.id}
                  className={`sales-metrics-dataset-card ${
                    selected ? "sales-metrics-dataset-card--active" : ""
                  }`}
                >
                  <div className="sales-metrics-dataset-header">
                    <label className="sales-metrics-dataset-toggle">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSelectedDatasetIds((current) =>
                            current.includes(dataset.id)
                              ? current.filter((id) => id !== dataset.id)
                              : [...current, dataset.id]
                          )
                        }
                      />
                      <span>{dataset.name}</span>
                    </label>
                    <button
                      type="button"
                      className="sales-metrics-remove-button"
                      onClick={() => void handleDeleteDataset(dataset)}
                      disabled={deletingDatasetId === dataset.id}
                    >
                      {deletingDatasetId === dataset.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                  <div className="sales-metrics-dataset-meta">
                    <span>{dataset.sourceKind === "seeded" ? "Seeded" : "Uploaded"}</span>
                    <span>{formatDateRange(dataset.saleDateMin, dataset.saleDateMax)}</span>
                    <span>{formatWholeNumber(dataset.pricedSaleCount)} priced sales</span>
                  </div>
                  <dl className="sales-metrics-dataset-stats">
                    <div>
                      <dt>Tracked rows</dt>
                      <dd>{formatWholeNumber(dataset.recordCount)}</dd>
                    </div>
                    <div>
                      <dt>PPSF rows</dt>
                      <dd>{formatWholeNumber(dataset.ppsfSaleCount)}</dd>
                    </div>
                    <div>
                      <dt>Total volume</dt>
                      <dd>{formatCurrency(dataset.totalSaleVolume)}</dd>
                    </div>
                  </dl>
                  <p className="sales-metrics-dataset-file">{dataset.originalFileName}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="sales-metrics-panel">
        <div className="sales-metrics-section-header">
          <div>
            <h2>Filters</h2>
            <p>Use multiple neighborhoods to compare PPSF trends side by side on the same comp set.</p>
          </div>
          <button
            type="button"
            className="sales-metrics-secondary-button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            disabled={selectedDatasetIds.length === 0}
          >
            Clear filters
          </button>
        </div>

        <div className="sales-metrics-filter-grid">
          <NeighborhoodMultiSelect
            options={queryData?.filters.neighborhoods ?? []}
            selected={filters.neighborhoods}
            disabled={selectedDatasetIds.length === 0}
            onChange={(next) => setFilters((current) => ({ ...current, neighborhoods: next }))}
          />

          <label className="sales-metrics-field">
            <span>Building class</span>
            <select
              value={filters.buildingClassCategory}
              onChange={(event) =>
                setFilters((current) => ({ ...current, buildingClassCategory: event.target.value }))
              }
              disabled={selectedDatasetIds.length === 0}
            >
              <option value="">All building classes</option>
              {(queryData?.filters.buildingClassCategories ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="sales-metrics-field">
            <span>Tax class</span>
            <select
              value={filters.taxClass}
              onChange={(event) => setFilters((current) => ({ ...current, taxClass: event.target.value }))}
              disabled={selectedDatasetIds.length === 0}
            >
              <option value="">All tax classes</option>
              {(queryData?.filters.taxClasses ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="sales-metrics-field">
            <span>Min units</span>
            <input
              type="number"
              value={filters.minUnits}
              placeholder={formatWholeNumber(queryData?.filters.unitsRange.min)}
              onChange={(event) => setFilters((current) => ({ ...current, minUnits: event.target.value }))}
              disabled={selectedDatasetIds.length === 0}
            />
          </label>

          <label className="sales-metrics-field">
            <span>Max units</span>
            <input
              type="number"
              value={filters.maxUnits}
              placeholder={formatWholeNumber(queryData?.filters.unitsRange.max)}
              onChange={(event) => setFilters((current) => ({ ...current, maxUnits: event.target.value }))}
              disabled={selectedDatasetIds.length === 0}
            />
          </label>

          <label className="sales-metrics-field">
            <span>Min gross SF</span>
            <input
              type="number"
              value={filters.minGrossSquareFeet}
              placeholder={formatWholeNumber(queryData?.filters.grossSquareFeetRange.min)}
              onChange={(event) =>
                setFilters((current) => ({ ...current, minGrossSquareFeet: event.target.value }))
              }
              disabled={selectedDatasetIds.length === 0}
            />
          </label>

          <label className="sales-metrics-field">
            <span>Max gross SF</span>
            <input
              type="number"
              value={filters.maxGrossSquareFeet}
              placeholder={formatWholeNumber(queryData?.filters.grossSquareFeetRange.max)}
              onChange={(event) =>
                setFilters((current) => ({ ...current, maxGrossSquareFeet: event.target.value }))
              }
              disabled={selectedDatasetIds.length === 0}
            />
          </label>

          <label className="sales-metrics-field">
            <span>Min price</span>
            <input
              type="number"
              value={filters.minPrice}
              placeholder={formatWholeNumber(queryData?.filters.salePriceRange.min)}
              onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
              disabled={selectedDatasetIds.length === 0}
            />
          </label>

          <label className="sales-metrics-field">
            <span>Max price</span>
            <input
              type="number"
              value={filters.maxPrice}
              placeholder={formatWholeNumber(queryData?.filters.salePriceRange.max)}
              onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
              disabled={selectedDatasetIds.length === 0}
            />
          </label>
        </div>
      </section>

      <section className="sales-metrics-panel">
        <div className="sales-metrics-section-header">
          <div>
            <h2>Summary metrics</h2>
            <p>
              Switch between a combined view of every selected sale and a neighborhood-by-neighborhood view
              for the same active filters.
            </p>
          </div>
          <div className="sales-metrics-view-toggle">
            <button
              type="button"
              className={`sales-metrics-view-toggle-button ${
                summaryMode === "combined" ? "sales-metrics-view-toggle-button--active" : ""
              }`}
              onClick={() => setSummaryMode("combined")}
            >
              Combined selection
            </button>
            <button
              type="button"
              className={`sales-metrics-view-toggle-button ${
                summaryMode === "neighborhood" ? "sales-metrics-view-toggle-button--active" : ""
              }`}
              onClick={() => setSummaryMode("neighborhood")}
            >
              Neighborhood basis
            </button>
          </div>
        </div>

        {summaryMode === "combined" ? (
          <div className="sales-metrics-summary-grid">
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Matched sales</span>
              <strong>{formatWholeNumber(queryData?.summary.saleCount)}</strong>
              <p>
                {loadingQuery
                  ? "Refreshing filtered sales set…"
                  : `${formatWholeNumber(queryData?.totals.datasetCount)} active dataset${queryData?.totals.datasetCount === 1 ? "" : "s"}`}
              </p>
            </article>
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Total sale volume</span>
              <strong>{formatCurrency(queryData?.summary.totalSaleVolume)}</strong>
              <p>{formatDateRange(queryData?.summary.saleDateMin, queryData?.summary.saleDateMax)}</p>
            </article>
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Median PPSF</span>
              <strong>{formatPpsf(queryData?.summary.medianPricePerGrossSquareFoot)}</strong>
              <p>{formatWholeNumber(queryData?.summary.ppsfSaleCount)} sales with gross SF</p>
            </article>
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Average PPSF</span>
              <strong>{formatPpsf(queryData?.summary.averagePricePerGrossSquareFoot)}</strong>
              <p>Based on gross square feet</p>
            </article>
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Median sale price</span>
              <strong>{formatCurrency(queryData?.summary.medianSalePrice)}</strong>
              <p>Average: {formatCurrency(queryData?.summary.averageSalePrice)}</p>
            </article>
            <article className="sales-metrics-summary-card">
              <span className="sales-metrics-summary-label">Median gross SF</span>
              <strong>{formatWholeNumber(queryData?.summary.medianGrossSquareFeet)}</strong>
              <p>Median units: {formatWholeNumber(queryData?.summary.medianUnits)}</p>
            </article>
          </div>
        ) : summaryNeighborhoodRows.length === 0 ? (
          <div className="sales-metrics-empty-state">
            <h3>No neighborhood metrics yet</h3>
            <p>Select one or more neighborhoods, or loosen your filters, to get neighborhood-level summary cards.</p>
          </div>
        ) : (
          <div className="sales-metrics-neighborhood-summary-grid">
            {summaryNeighborhoodRows.map((row) => (
              <article key={row.key} className="sales-metrics-neighborhood-summary-card">
                <div className="sales-metrics-neighborhood-summary-top">
                  <div>
                    <span className="sales-metrics-summary-label">Neighborhood</span>
                    <strong>{row.label}</strong>
                  </div>
                  <div className="sales-metrics-neighborhood-badge">{formatWholeNumber(row.saleCount)} sales</div>
                </div>
                <div className="sales-metrics-neighborhood-metrics">
                  <div>
                    <span>Median PPSF</span>
                    <strong>{formatPpsf(row.medianPricePerGrossSquareFoot)}</strong>
                  </div>
                  <div>
                    <span>Avg PPSF</span>
                    <strong>{formatPpsf(row.averagePricePerGrossSquareFoot)}</strong>
                  </div>
                  <div>
                    <span>Median price</span>
                    <strong>{formatCurrency(row.medianSalePrice)}</strong>
                  </div>
                  <div>
                    <span>Total volume</span>
                    <strong>{formatCurrency(row.totalSaleVolume)}</strong>
                  </div>
                </div>
                <p>{formatDateRange(row.saleDateMin, row.saleDateMax)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {showingNeighborhoodComparison ? (
        <TrendComparisonTable rows={queryData?.trendRows ?? []} comparisonNeighborhoods={comparisonNeighborhoods} />
      ) : null}

      <div className="sales-metrics-table-grid">
        <GroupTable
          title="Dataset comparison"
          subtitle="Compare filtered pricing by imported file."
          rows={queryData?.datasetTable ?? []}
        />
        <GroupTable
          title="Neighborhood breakdown"
          subtitle="Median and average PPSF rolled up by neighborhood."
          rows={queryData?.neighborhoodTable ?? []}
        />
      </div>

      <GroupTable
        title="Building class breakdown"
        subtitle="Use this to compare walkups, elevator rentals, mixed-use buildings, and more."
        rows={queryData?.buildingClassTable ?? []}
      />

      <section className="sales-metrics-table-card">
        <div className="sales-metrics-section-header">
          <div>
            <h2>Matching transactions</h2>
            <p>
              Recent priced sales matching the active dataset set and filters. Showing{" "}
              {formatWholeNumber(queryData?.totals.shownTransactions)} of{" "}
              {formatWholeNumber(queryData?.totals.matchedSales)}.
            </p>
          </div>
        </div>
        <div className="sales-metrics-table-wrap">
          <table className="sales-metrics-table sales-metrics-table--transactions">
            <thead>
              <tr>
                <th>Sale</th>
                <th>Property</th>
                <th>Neighborhood</th>
                <th>Building class</th>
                <th>Tax class</th>
                <th>Units</th>
                <th>Gross SF</th>
                <th>Sale price</th>
                <th>PPSF</th>
                <th>Dataset</th>
              </tr>
            </thead>
            <tbody>
              {(queryData?.transactions ?? []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="sales-metrics-empty-row">
                    {selectedDatasetIds.length === 0
                      ? "Select at least one dataset to see transactions."
                      : "No priced sales match the current filters."}
                  </td>
                </tr>
              ) : (
                (queryData?.transactions ?? []).map((transaction) => (
                  <tr key={`${transaction.datasetId}-${transaction.id}`}>
                    <td>{formatShortDate(transaction.saleDate)}</td>
                    <td>
                      <div className="sales-metrics-row-title">{composeAddress(transaction)}</div>
                    </td>
                    <td>{transaction.neighborhood ?? "—"}</td>
                    <td>{transaction.buildingClassCategory ?? "—"}</td>
                    <td>{transaction.taxClassAtPresent ?? "—"}</td>
                    <td>{formatWholeNumber(transaction.totalUnits)}</td>
                    <td>{formatWholeNumber(transaction.grossSquareFeet)}</td>
                    <td>{formatCurrency(transaction.salePrice)}</td>
                    <td>{formatPpsf(transaction.pricePerGrossSquareFoot)}</td>
                    <td>{transaction.datasetName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
