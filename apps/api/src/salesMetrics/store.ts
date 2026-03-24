import { randomUUID } from "crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { basename, extname, join, normalize, relative, sep } from "path";
import * as XLSX from "xlsx";

const DEFAULT_BASE = "uploads/sales-metrics";
const INDEX_FILE_NAME = "datasets.json";
const MAX_TRANSACTION_ROWS = 200;
const API_PACKAGE_ROOT = normalize(fileURLToPath(new URL("../..", import.meta.url)));

export type SalesDatasetSourceKind = "uploaded" | "seeded";

export interface SalesMetricsDataset {
  id: string;
  name: string;
  title: string | null;
  originalFileName: string;
  filePath: string;
  sourceKind: SalesDatasetSourceKind;
  importedAt: string;
  recordCount: number;
  pricedSaleCount: number;
  ppsfSaleCount: number;
  totalSaleVolume: number;
  saleDateMin: string | null;
  saleDateMax: string | null;
}

export interface SalesMetricsRecord {
  id: string;
  datasetId: string;
  datasetName: string;
  borough: string | null;
  neighborhood: string | null;
  buildingClassCategory: string | null;
  taxClassAtPresent: string | null;
  taxClassAtTimeOfSale: string | null;
  block: string | null;
  lot: string | null;
  buildingClassAtPresent: string | null;
  buildingClassAtTimeOfSale: string | null;
  address: string | null;
  apartmentNumber: string | null;
  zipCode: string | null;
  residentialUnits: number | null;
  commercialUnits: number | null;
  totalUnits: number | null;
  landSquareFeet: number | null;
  grossSquareFeet: number | null;
  yearBuilt: number | null;
  salePrice: number | null;
  saleDate: string | null;
  pricePerGrossSquareFoot: number | null;
}

export interface SalesMetricsFilters {
  datasetIds?: string[];
  neighborhoods?: string[];
  buildingClassCategory?: string | null;
  taxClass?: string | null;
  minUnits?: number | null;
  maxUnits?: number | null;
  minGrossSquareFeet?: number | null;
  maxGrossSquareFeet?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface SalesMetricsSummary {
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

export interface SalesMetricsGroupRow {
  key: string;
  label: string;
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

export interface SalesMetricsTrendNeighborhoodRow {
  neighborhood: string;
  summary: SalesMetricsSummary;
}

export interface SalesMetricsTrendRow {
  bucketKey: string;
  bucketLabel: string;
  summary: SalesMetricsSummary;
  neighborhoods: SalesMetricsTrendNeighborhoodRow[];
}

export interface SalesMetricsQueryResult {
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
  summary: SalesMetricsSummary;
  datasetTable: SalesMetricsGroupRow[];
  neighborhoodTable: SalesMetricsGroupRow[];
  buildingClassTable: SalesMetricsGroupRow[];
  comparisonNeighborhoods: string[];
  trendRows: SalesMetricsTrendRow[];
  transactions: SalesMetricsRecord[];
}

interface SalesMetricsIndexFile {
  datasets: SalesMetricsDataset[];
}

interface ParsedDataset {
  title: string | null;
  records: Array<Omit<SalesMetricsRecord, "datasetId" | "datasetName">>;
}

const datasetCache = new Map<string, { fingerprint: string; records: SalesMetricsRecord[] }>();

function getBaseDir(): string {
  return process.env.SALES_METRICS_PATH ?? DEFAULT_BASE;
}

function getAbsoluteBaseDir(): string {
  const base = getBaseDir();
  if (base.startsWith("/") || /^[A-Za-z]:\\/.test(base)) return normalize(base);
  return normalize(join(API_PACKAGE_ROOT, base));
}

function getIndexPath(): string {
  return join(getAbsoluteBaseDir(), INDEX_FILE_NAME);
}

function toStoredDatasetFilePath(filePath: string): string {
  const normalizedPath = normalize(filePath);
  const absoluteBaseDir = getAbsoluteBaseDir();
  if (normalizedPath === absoluteBaseDir) return ".";
  if (normalizedPath.startsWith(`${absoluteBaseDir}${sep}`)) {
    return relative(absoluteBaseDir, normalizedPath);
  }
  return normalizedPath;
}

function resolveDatasetFilePath(filePath: string): string {
  const normalizedPath = normalize(filePath);
  if (normalizedPath === ".") return getAbsoluteBaseDir();
  if (normalizedPath.startsWith("/") || /^[A-Za-z]:\\/.test(normalizedPath)) return normalizedPath;
  return normalize(join(getAbsoluteBaseDir(), normalizedPath));
}

async function ensureBaseDir(): Promise<void> {
  await mkdir(getAbsoluteBaseDir(), { recursive: true });
}

async function readIndex(): Promise<SalesMetricsIndexFile> {
  await ensureBaseDir();
  try {
    const raw = await readFile(getIndexPath(), "utf8");
    const parsed = JSON.parse(raw) as SalesMetricsIndexFile;
    return {
      datasets: Array.isArray(parsed.datasets) ? parsed.datasets : [],
    };
  } catch {
    return { datasets: [] };
  }
}

async function writeIndex(index: SalesMetricsIndexFile): Promise<void> {
  await ensureBaseDir();
  await writeFile(getIndexPath(), JSON.stringify(index, null, 2), "utf8");
}

function normalizeHeaderValue(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[$,\s]/g, "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  return Math.round(parsed);
}

function parseSaleDate(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) return null;
    return fallback.toISOString().slice(0, 10);
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatDatasetName(originalFileName: string, title: string | null): string {
  if (title?.trim()) return title.trim();
  const base = basename(originalFileName, extname(originalFileName));
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const normalized = row.map((value) => normalizeHeaderValue(value));
    return normalized.includes("BOROUGH") && normalized.includes("SALE DATE");
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint] ?? null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricRange(values: number[]): { min: number | null; max: number | null } {
  if (values.length === 0) return { min: null, max: null };
  let min = values[0] ?? null;
  let max = values[0] ?? null;
  for (const value of values) {
    if (min == null || value < min) min = value;
    if (max == null || value > max) max = value;
  }
  return {
    min,
    max,
  };
}

function emptySummary(): SalesMetricsSummary {
  return {
    saleCount: 0,
    ppsfSaleCount: 0,
    totalSaleVolume: 0,
    averageSalePrice: null,
    medianSalePrice: null,
    averagePricePerGrossSquareFoot: null,
    medianPricePerGrossSquareFoot: null,
    averageGrossSquareFeet: null,
    medianGrossSquareFeet: null,
    averageUnits: null,
    medianUnits: null,
    saleDateMin: null,
    saleDateMax: null,
  };
}

function groupRowToSummary(row: SalesMetricsGroupRow): SalesMetricsSummary {
  return {
    saleCount: row.saleCount,
    ppsfSaleCount: row.ppsfSaleCount,
    totalSaleVolume: row.totalSaleVolume,
    averageSalePrice: row.averageSalePrice,
    medianSalePrice: row.medianSalePrice,
    averagePricePerGrossSquareFoot: row.averagePricePerGrossSquareFoot,
    medianPricePerGrossSquareFoot: row.medianPricePerGrossSquareFoot,
    averageGrossSquareFeet: row.averageGrossSquareFeet,
    medianGrossSquareFeet: row.medianGrossSquareFeet,
    averageUnits: row.averageUnits,
    medianUnits: row.medianUnits,
    saleDateMin: row.saleDateMin,
    saleDateMax: row.saleDateMax,
  };
}

function quarterBucket(saleDate: string | null): { key: string; label: string } | null {
  if (!saleDate) return null;
  const [yearValue, monthValue] = saleDate.split("-").map((value) => Number(value));
  if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) return null;
  const quarter = Math.floor((monthValue - 1) / 3) + 1;
  return {
    key: `${yearValue}-Q${quarter}`,
    label: `${yearValue} Q${quarter}`,
  };
}

function summarizeRecords(records: SalesMetricsRecord[]): SalesMetricsSummary {
  const salePrices = records
    .map((record) => record.salePrice)
    .filter((value): value is number => value != null && value > 0);
  const ppsfValues = records
    .map((record) => record.pricePerGrossSquareFoot)
    .filter((value): value is number => value != null && value > 0);
  const grossSquareFeetValues = records
    .map((record) => record.grossSquareFeet)
    .filter((value): value is number => value != null && value > 0);
  const unitValues = records
    .map((record) => record.totalUnits)
    .filter((value): value is number => value != null && value > 0);
  const datedRecords = records
    .map((record) => record.saleDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    saleCount: records.length,
    ppsfSaleCount: ppsfValues.length,
    totalSaleVolume: salePrices.reduce((sum, value) => sum + value, 0),
    averageSalePrice: average(salePrices),
    medianSalePrice: median(salePrices),
    averagePricePerGrossSquareFoot: average(ppsfValues),
    medianPricePerGrossSquareFoot: median(ppsfValues),
    averageGrossSquareFeet: average(grossSquareFeetValues),
    medianGrossSquareFeet: median(grossSquareFeetValues),
    averageUnits: average(unitValues),
    medianUnits: median(unitValues),
    saleDateMin: datedRecords[0] ?? null,
    saleDateMax: datedRecords[datedRecords.length - 1] ?? null,
  };
}

function groupRecords(
  records: SalesMetricsRecord[],
  getKey: (record: SalesMetricsRecord) => string | null | undefined
): SalesMetricsGroupRow[] {
  const groups = new Map<string, SalesMetricsRecord[]>();
  for (const record of records) {
    const label = normalizeText(getKey(record)) ?? "Unknown";
    const existing = groups.get(label);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(label, [record]);
    }
  }

  return Array.from(groups.entries())
    .map(([label, groupRecords]) => {
      const summary = summarizeRecords(groupRecords);
      return {
        key: label,
        label,
        ...summary,
      };
    })
    .sort((left, right) => {
      if (right.saleCount !== left.saleCount) return right.saleCount - left.saleCount;
      if (right.totalSaleVolume !== left.totalSaleVolume) return right.totalSaleVolume - left.totalSaleVolume;
      return left.label.localeCompare(right.label);
    });
}

function matchesRange(value: number | null, min?: number | null, max?: number | null): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function filterRecords(records: SalesMetricsRecord[], filters: SalesMetricsFilters): SalesMetricsRecord[] {
  const neighborhoods = new Set(
    (filters.neighborhoods ?? [])
      .map((value) => normalizeText(value))
      .filter((value): value is string => Boolean(value))
  );
  const buildingClassCategory = normalizeText(filters.buildingClassCategory);
  const taxClass = normalizeText(filters.taxClass);

  return records.filter((record) => {
    if ((record.salePrice ?? 0) <= 0) return false;
    if (neighborhoods.size > 0 && (!record.neighborhood || !neighborhoods.has(record.neighborhood))) return false;
    if (buildingClassCategory && record.buildingClassCategory !== buildingClassCategory) return false;
    if (taxClass && record.taxClassAtPresent !== taxClass) return false;
    if (!matchesRange(record.totalUnits, filters.minUnits, filters.maxUnits)) return false;
    if (!matchesRange(record.grossSquareFeet, filters.minGrossSquareFeet, filters.maxGrossSquareFeet)) return false;
    if (!matchesRange(record.salePrice, filters.minPrice, filters.maxPrice)) return false;
    return true;
  });
}

function parseWorkbook(buffer: Buffer): ParsedDataset {
  const workbook = XLSX.read(buffer, { type: "buffer", dense: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The workbook does not contain any sheets.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    throw new Error("The first sheet could not be loaded.");
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error("Could not find the sales header row. Expected columns like BOROUGH and SALE DATE.");
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const headerLookup = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const normalized = normalizeHeaderValue(value);
    if (normalized) headerLookup.set(normalized, index);
  });

  const getColumn = (...names: string[]): number => {
    for (const name of names) {
      const found = headerLookup.get(name);
      if (found != null) return found;
    }
    return -1;
  };

  const title = normalizeText((rows[0] ?? [])[0]);
  const boroughCol = getColumn("BOROUGH");
  const neighborhoodCol = getColumn("NEIGHBORHOOD");
  const buildingClassCategoryCol = getColumn("BUILDING CLASS CATEGORY");
  const taxClassAtPresentCol = getColumn("TAX CLASS AT PRESENT");
  const blockCol = getColumn("BLOCK");
  const lotCol = getColumn("LOT");
  const buildingClassAtPresentCol = getColumn("BUILDING CLASS AT PRESENT");
  const addressCol = getColumn("ADDRESS");
  const apartmentNumberCol = getColumn("APARTMENT NUMBER");
  const zipCodeCol = getColumn("ZIP CODE");
  const residentialUnitsCol = getColumn("RESIDENTIAL UNITS");
  const commercialUnitsCol = getColumn("COMMERCIAL UNITS");
  const totalUnitsCol = getColumn("TOTAL UNITS");
  const landSquareFeetCol = getColumn("LAND SQUARE FEET");
  const grossSquareFeetCol = getColumn("GROSS SQUARE FEET");
  const yearBuiltCol = getColumn("YEAR BUILT");
  const taxClassAtTimeOfSaleCol = getColumn("TAX CLASS AT TIME OF SALE");
  const buildingClassAtTimeOfSaleCol = getColumn("BUILDING CLASS AT TIME OF SALE");
  const salePriceCol = getColumn("SALE PRICE");
  const saleDateCol = getColumn("SALE DATE");

  const records: Array<Omit<SalesMetricsRecord, "datasetId" | "datasetName">> = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (!row.some((value) => normalizeText(value))) continue;
    const salePrice = parseNumber(row[salePriceCol]);
    const grossSquareFeet = parseNumber(row[grossSquareFeetCol]);

    records.push({
      id: `row-${rowIndex + 1}`,
      borough: normalizeText(row[boroughCol]),
      neighborhood: normalizeText(row[neighborhoodCol]),
      buildingClassCategory: normalizeText(row[buildingClassCategoryCol]),
      taxClassAtPresent: normalizeText(row[taxClassAtPresentCol]),
      taxClassAtTimeOfSale: normalizeText(row[taxClassAtTimeOfSaleCol]),
      block: normalizeText(row[blockCol]),
      lot: normalizeText(row[lotCol]),
      buildingClassAtPresent: normalizeText(row[buildingClassAtPresentCol]),
      buildingClassAtTimeOfSale: normalizeText(row[buildingClassAtTimeOfSaleCol]),
      address: normalizeText(row[addressCol]),
      apartmentNumber: normalizeText(row[apartmentNumberCol]),
      zipCode: normalizeText(row[zipCodeCol]),
      residentialUnits: parseNumber(row[residentialUnitsCol]),
      commercialUnits: parseNumber(row[commercialUnitsCol]),
      totalUnits: parseNumber(row[totalUnitsCol]),
      landSquareFeet: parseNumber(row[landSquareFeetCol]),
      grossSquareFeet,
      yearBuilt: parseInteger(row[yearBuiltCol]),
      salePrice,
      saleDate: parseSaleDate(row[saleDateCol]),
      pricePerGrossSquareFoot:
        salePrice != null && salePrice > 0 && grossSquareFeet != null && grossSquareFeet > 0
          ? salePrice / grossSquareFeet
          : null,
    });
  }

  return { title, records };
}

function withDataset(records: ParsedDataset["records"], dataset: SalesMetricsDataset): SalesMetricsRecord[] {
  return records.map((record) => ({
    ...record,
    datasetId: dataset.id,
    datasetName: dataset.name,
  }));
}

async function readBufferFromDatasetFile(filePath: string): Promise<Buffer> {
  return readFile(resolveDatasetFilePath(filePath));
}

async function buildDatasetMetadata(params: {
  id: string;
  originalFileName: string;
  filePath: string;
  sourceKind: SalesDatasetSourceKind;
  importedAt?: string;
  parsed?: ParsedDataset;
}): Promise<{ dataset: SalesMetricsDataset; records: SalesMetricsRecord[] }> {
  const parsed = params.parsed ?? parseWorkbook(await readBufferFromDatasetFile(params.filePath));
  const importedAt = params.importedAt ?? new Date().toISOString();
  const name = formatDatasetName(params.originalFileName, parsed.title);
  const dataset: SalesMetricsDataset = {
    id: params.id,
    name,
    title: parsed.title,
    originalFileName: params.originalFileName,
    filePath: toStoredDatasetFilePath(params.filePath),
    sourceKind: params.sourceKind,
    importedAt,
    recordCount: parsed.records.length,
    pricedSaleCount: parsed.records.filter((record) => (record.salePrice ?? 0) > 0).length,
    ppsfSaleCount: parsed.records.filter((record) => (record.pricePerGrossSquareFoot ?? 0) > 0).length,
    totalSaleVolume: parsed.records.reduce(
      (sum, record) => sum + ((record.salePrice ?? 0) > 0 ? (record.salePrice ?? 0) : 0),
      0
    ),
    saleDateMin:
      parsed.records
        .map((record) => record.saleDate)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
    saleDateMax:
      parsed.records
        .map((record) => record.saleDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
  };

  return {
    dataset,
    records: withDataset(parsed.records, dataset),
  };
}

export async function listSalesDatasets(): Promise<SalesMetricsDataset[]> {
  const index = await readIndex();
  return [...index.datasets].sort((left, right) => {
    const leftDate = left.saleDateMin ?? left.importedAt;
    const rightDate = right.saleDateMin ?? right.importedAt;
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return left.name.localeCompare(right.name);
  });
}

export async function importSalesDatasetFromBuffer(params: {
  buffer: Buffer;
  originalFileName: string;
  sourceKind?: SalesDatasetSourceKind;
}): Promise<SalesMetricsDataset> {
  const datasetId = randomUUID();
  const importedAt = new Date().toISOString();
  const sourceKind = params.sourceKind ?? "uploaded";
  const safeFileName =
    params.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").trim() || `sales-dataset-${datasetId}.xlsx`;
  const directory = join(getAbsoluteBaseDir(), datasetId);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, safeFileName);
  try {
    await writeFile(filePath, params.buffer);

    const parsed = parseWorkbook(params.buffer);
    const { dataset, records } = await buildDatasetMetadata({
      id: datasetId,
      originalFileName: params.originalFileName,
      filePath,
      sourceKind,
      importedAt,
      parsed,
    });

    const index = await readIndex();
    index.datasets = [...index.datasets, dataset];
    await writeIndex(index);
    const fileStats = await stat(filePath);
    datasetCache.set(dataset.id, {
      fingerprint: `${fileStats.mtimeMs}:${fileStats.size}`,
      records,
    });
    return dataset;
  } catch (err) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function importSalesDatasetFromFile(params: {
  filePath: string;
  sourceKind?: SalesDatasetSourceKind;
}): Promise<SalesMetricsDataset> {
  const sourcePath = normalize(params.filePath);
  const buffer = await readFile(sourcePath);
  const datasetId = randomUUID();
  const importedAt = new Date().toISOString();
  const sourceKind = params.sourceKind ?? "seeded";
  const safeFileName =
    basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_").trim() || `sales-dataset-${datasetId}.xlsx`;
  const directory = join(getAbsoluteBaseDir(), datasetId);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, safeFileName);
  try {
    await copyFile(sourcePath, filePath);

    const parsed = parseWorkbook(buffer);
    const { dataset, records } = await buildDatasetMetadata({
      id: datasetId,
      originalFileName: basename(sourcePath),
      filePath,
      sourceKind,
      importedAt,
      parsed,
    });

    const index = await readIndex();
    index.datasets = [...index.datasets, dataset];
    await writeIndex(index);
    const fileStats = await stat(filePath);
    datasetCache.set(dataset.id, {
      fingerprint: `${fileStats.mtimeMs}:${fileStats.size}`,
      records,
    });
    return dataset;
  } catch (err) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function deleteSalesDataset(datasetId: string): Promise<boolean> {
  const index = await readIndex();
  const dataset = index.datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return false;

  index.datasets = index.datasets.filter((entry) => entry.id !== datasetId);
  await writeIndex(index);
  datasetCache.delete(datasetId);
  await rm(join(getAbsoluteBaseDir(), datasetId), { recursive: true, force: true }).catch(() => {});
  return true;
}

async function loadDatasetRecords(dataset: SalesMetricsDataset): Promise<SalesMetricsRecord[]> {
  const resolvedFilePath = resolveDatasetFilePath(dataset.filePath);
  const fileStats = await stat(resolvedFilePath);
  const fingerprint = `${fileStats.mtimeMs}:${fileStats.size}`;
  const cached = datasetCache.get(dataset.id);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.records;
  }

  const parsed = parseWorkbook(await readBufferFromDatasetFile(dataset.filePath));
  const records = withDataset(parsed.records, dataset);
  datasetCache.set(dataset.id, { fingerprint, records });
  return records;
}

function resolveComparisonNeighborhoods(
  filters: SalesMetricsFilters,
  neighborhoodTable: SalesMetricsGroupRow[]
): string[] {
  const requestedNeighborhoods = (filters.neighborhoods ?? [])
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));
  if (requestedNeighborhoods.length > 0) return requestedNeighborhoods;

  return neighborhoodTable.slice(0, 4).map((row) => row.label);
}

function buildTrendRows(
  records: SalesMetricsRecord[],
  comparisonNeighborhoods: string[]
): SalesMetricsTrendRow[] {
  const buckets = new Map<string, { label: string; records: SalesMetricsRecord[] }>();
  for (const record of records) {
    const bucket = quarterBucket(record.saleDate);
    if (!bucket) continue;
    const existing = buckets.get(bucket.key);
    if (existing) {
      existing.records.push(record);
    } else {
      buckets.set(bucket.key, {
        label: bucket.label,
        records: [record],
      });
    }
  }

  return Array.from(buckets.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([bucketKey, bucket]) => {
      const neighborhoodGroups = groupRecords(
        bucket.records.filter(
          (record) => record.neighborhood != null && comparisonNeighborhoods.includes(record.neighborhood)
        ),
        (record) => record.neighborhood
      );

      return {
        bucketKey,
        bucketLabel: bucket.label,
        summary: summarizeRecords(bucket.records),
        neighborhoods: comparisonNeighborhoods.map((neighborhood) => {
          const match = neighborhoodGroups.find((row) => row.label === neighborhood);
          return {
            neighborhood,
            summary: match ? groupRowToSummary(match) : emptySummary(),
          };
        }),
      };
    });
}

export async function querySalesMetrics(filters: SalesMetricsFilters): Promise<SalesMetricsQueryResult> {
  const datasets = await listSalesDatasets();
  const selectedDatasets =
    filters.datasetIds && filters.datasetIds.length > 0
      ? datasets.filter((dataset) => filters.datasetIds?.includes(dataset.id))
      : datasets;

  const allRecords = (await Promise.all(selectedDatasets.map((dataset) => loadDatasetRecords(dataset)))).flat();
  const availableRecords = allRecords.filter((record) => (record.salePrice ?? 0) > 0);
  const filteredRecords = filterRecords(availableRecords, filters);
  const neighborhoodTable = groupRecords(filteredRecords, (record) => record.neighborhood);
  const comparisonNeighborhoods = resolveComparisonNeighborhoods(filters, neighborhoodTable);
  const transactions = [...filteredRecords]
    .sort((left, right) => {
      const leftDate = left.saleDate ?? "";
      const rightDate = right.saleDate ?? "";
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return (right.salePrice ?? 0) - (left.salePrice ?? 0);
    })
    .slice(0, MAX_TRANSACTION_ROWS);

  return {
    filters: {
      neighborhoods: Array.from(
        new Set(availableRecords.map((record) => record.neighborhood).filter((value): value is string => Boolean(value)))
      ).sort((left, right) => left.localeCompare(right)),
      buildingClassCategories: Array.from(
        new Set(
          availableRecords
            .map((record) => record.buildingClassCategory)
            .filter((value): value is string => Boolean(value))
        )
      ).sort((left, right) => left.localeCompare(right)),
      taxClasses: Array.from(
        new Set(availableRecords.map((record) => record.taxClassAtPresent).filter((value): value is string => Boolean(value)))
      ).sort((left, right) => left.localeCompare(right)),
      unitsRange: metricRange(
        availableRecords
          .map((record) => record.totalUnits)
          .filter((value): value is number => value != null && value > 0)
      ),
      grossSquareFeetRange: metricRange(
        availableRecords
          .map((record) => record.grossSquareFeet)
          .filter((value): value is number => value != null && value > 0)
      ),
      salePriceRange: metricRange(
        availableRecords
          .map((record) => record.salePrice)
          .filter((value): value is number => value != null && value > 0)
      ),
    },
    totals: {
      datasetCount: selectedDatasets.length,
      matchedSales: filteredRecords.length,
      shownTransactions: transactions.length,
    },
    summary: summarizeRecords(filteredRecords),
    datasetTable: groupRecords(filteredRecords, (record) => record.datasetName),
    neighborhoodTable,
    buildingClassTable: groupRecords(filteredRecords, (record) => record.buildingClassCategory),
    comparisonNeighborhoods,
    trendRows: buildTrendRows(filteredRecords, comparisonNeighborhoods),
    transactions,
  };
}
