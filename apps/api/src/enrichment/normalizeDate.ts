/**
 * Parse common date formats to YYYY-MM-DD or null. Shared across enrichment modules.
 */
export function parseDateToYyyyMmDd(str: string | null | undefined): string | null {
  if (str == null || typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
