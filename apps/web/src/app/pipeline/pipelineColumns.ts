/**
 * Pipeline table column registry — the single source of truth for column
 * order, labels, and widths. The <colgroup>, header row, and body cells in
 * PipelineClient.tsx are all filtered through this list, so the three always
 * agree on which columns exist.
 *
 * INVARIANTS:
 * - The entry order matches the JSX cell order exactly.
 * - "actions" must remain LAST and LOCKED — the sticky right column is
 *   styled via td:last-child / th:last-child selectors.
 * - Locked columns can never be hidden (selection, identity, actions).
 */

export const PIPELINE_COLUMNS_STORAGE_KEY = "sourcing-os.pipeline.columns.v1";

export type PipelineColumnId =
  | "select"
  | "star"
  | "address"
  | "stage"
  | "source"
  | "propertyType"
  | "marketType"
  | "listedAt"
  | "createdAt"
  | "updatedAt"
  | "ask"
  | "psf"
  | "yocLtr"
  | "yocMtr"
  | "units"
  | "sqft"
  | "score"
  | "status"
  | "tracker"
  | "enrich"
  | "flow"
  | "tags"
  | "actions";

export interface PipelineColumnDef {
  id: PipelineColumnId;
  label: string;
  /** Class key in PipelinePage.module.css applied to the <col>. */
  colClass: string;
  /** Width weight in px (the CSS rem width × 16); drives the table min-width. */
  widthPx: number;
  locked?: boolean;
}

export const PIPELINE_COLUMNS: readonly PipelineColumnDef[] = [
  { id: "select", label: "Select", colClass: "colSelect", widthPx: 38, locked: true },
  { id: "star", label: "Saved", colClass: "colStar", widthPx: 41, locked: true },
  { id: "address", label: "Address", colClass: "colAddress", widthPx: 352, locked: true },
  { id: "stage", label: "Stage", colClass: "colStage", widthPx: 116 },
  { id: "source", label: "Source", colClass: "colSource", widthPx: 109 },
  { id: "propertyType", label: "Property Type", colClass: "colPropertyType", widthPx: 131 },
  { id: "marketType", label: "Market", colClass: "colType", widthPx: 114 },
  { id: "listedAt", label: "Date Listed", colClass: "colDate", widthPx: 96 },
  { id: "createdAt", label: "Date Added", colClass: "colDate", widthPx: 96 },
  { id: "updatedAt", label: "Updated", colClass: "colDate", widthPx: 96 },
  { id: "ask", label: "Ask", colClass: "colAsk", widthPx: 168 },
  { id: "psf", label: "$/SF", colClass: "colPsf", widthPx: 90 },
  { id: "yocLtr", label: "YoC LTR", colClass: "colYoc", widthPx: 88 },
  { id: "yocMtr", label: "YoC MTR", colClass: "colYoc", widthPx: 88 },
  { id: "units", label: "Units", colClass: "colUnit", widthPx: 70 },
  { id: "sqft", label: "SF", colClass: "colSqft", widthPx: 86 },
  { id: "score", label: "Score", colClass: "colScore", widthPx: 98 },
  { id: "status", label: "Status", colClass: "colStatus", widthPx: 176 },
  { id: "tracker", label: "Tracker", colClass: "colOm", widthPx: 221 },
  { id: "enrich", label: "Enrich", colClass: "colEnrich", widthPx: 94 },
  { id: "flow", label: "Flow", colClass: "colFlow", widthPx: 77 },
  { id: "tags", label: "Tags", colClass: "colTags", widthPx: 160 },
  { id: "actions", label: "Action", colClass: "colAction", widthPx: 144, locked: true },
];

/** The historical CSS min-width the full column set was tuned against. */
const BASE_TABLE_MIN_WIDTH_PX = 2356;

const TOTAL_WEIGHT = PIPELINE_COLUMNS.reduce((sum, column) => sum + column.widthPx, 0);

export function isLockedPipelineColumn(id: PipelineColumnId): boolean {
  return PIPELINE_COLUMNS.find((column) => column.id === id)?.locked === true;
}

/**
 * Table min-width for the visible column set: column widths act as weights
 * under table-layout: fixed, so the min-width scales with the visible share
 * of the total weight (keeping today's proportions when nothing is hidden).
 */
export function pipelineTableMinWidth(visible: readonly PipelineColumnDef[]): number {
  const visibleWeight = visible.reduce((sum, column) => sum + column.widthPx, 0);
  return Math.round((visibleWeight / TOTAL_WEIGHT) * BASE_TABLE_MIN_WIDTH_PX);
}
