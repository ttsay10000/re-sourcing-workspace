import type { PropertySourcingUpdate, PropertySourcingUpdateChange } from "@re-sourcing/contracts";

export interface SourcingUpdateMeta {
  label: string;
  detail: string;
  style: {
    color: string;
    backgroundColor: string;
    borderColor: string;
  };
}

export function getSourcingUpdate(details: Record<string, unknown> | null | undefined): PropertySourcingUpdate | null {
  const raw = details?.sourcingUpdate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as PropertySourcingUpdate;
}

export function getSourcingUpdateMeta(details: Record<string, unknown> | null | undefined): SourcingUpdateMeta {
  const update = getSourcingUpdate(details);
  if (!update?.status) {
    return {
      label: "Not evaluated",
      detail: "No saved-search diff yet",
      style: { color: "#475569", backgroundColor: "#f8fafc", borderColor: "#cbd5e1" },
    };
  }
  if (update.status === "new") {
    return {
      label: "New",
      detail: update.lastEvaluatedAt ? `Added ${formatShortDate(update.lastEvaluatedAt)}` : "Added this run",
      style: { color: "#1d4ed8", backgroundColor: "#dbeafe", borderColor: "#93c5fd" },
    };
  }
  if (update.status === "updated") {
    const count = update.changes?.length ?? update.changedFields?.length ?? 0;
    return {
      label: "Updated",
      detail: count > 0 ? `${count} change${count === 1 ? "" : "s"}` : "Updated this run",
      style: { color: "#9a3412", backgroundColor: "#ffedd5", borderColor: "#fdba74" },
    };
  }
  return {
    label: "No changes",
    detail: update.lastEvaluatedAt ? `Checked ${formatShortDate(update.lastEvaluatedAt)}` : "Checked this run",
    style: { color: "#475569", backgroundColor: "#f8fafc", borderColor: "#cbd5e1" },
  };
}

export function formatSourcingUpdateChange(change: PropertySourcingUpdateChange): string {
  const previousValue = formatSourcingUpdateValue(change.field, change.previousValue);
  const currentValue = formatSourcingUpdateValue(change.field, change.currentValue);
  if (change.changeType === "added") {
    return currentValue !== "—" ? `${change.label} added: ${currentValue}` : `${change.label} added`;
  }
  if (change.changeType === "removed") {
    return previousValue !== "—" ? `${change.label} removed: ${previousValue}` : `${change.label} removed`;
  }
  if (previousValue !== "—" && currentValue !== "—") {
    return `${change.label}: ${previousValue} -> ${currentValue}`;
  }
  if (currentValue !== "—") return `${change.label}: ${currentValue}`;
  if (previousValue !== "—") return `${change.label}: ${previousValue}`;
  return change.label;
}

function formatSourcingUpdateValue(
  field: string,
  value: string | number | boolean | null | undefined
): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    if (field === "price" || field === "monthlyHoa" || field === "monthlyTax") {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
