/** Shared display formatters for the Deal Progress board, drawer, and queues. */

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatWholeCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatUnitLabel(value: number | null | undefined): string | null {
  const formatted = formatNumber(value);
  if (formatted === "—") return null;
  return `${formatted} ${formatted === "1" ? "unit" : "units"}`;
}

/** Board cards show only the street line; the full address stays in tooltips/drawers. */
export function streetAddressOnly(address: string): string {
  const street = address.split(",")[0]?.trim();
  return street || address;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDaysAgo(value: string | null | undefined): string {
  if (!value) return "never";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "never";
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function labelFromKey(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const normalized = value.trim().toLowerCase();
  const specialLabels: Record<string, string> = {
    awaiting_broker: "OM Requested",
    contract_signed: "Contract Signed",
    deal_closed: "Deal Closed",
    dossier_generated: "Dossier Generated",
    loopnet: "LoopNet",
    offer_review: "LOI Offered",
    sourced: "Sourced",
    om_received: "OM Received",
    streeteasy: "StreetEasy",
    tour_requested: "Tour Requested",
    tour_scheduled: "Tour Scheduled",
    tour_completed_awaiting_inputs: "Tour Completed",
    underwriting_awaiting_review: "Underwriting - Awaiting User Review",
    underwriting_review_completed: "Underwriting - Review Completed",
  };
  if (specialLabels[normalized]) return specialLabels[normalized];
  return normalized
    .split("_")
    .flatMap((part) => part.split("-"))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
