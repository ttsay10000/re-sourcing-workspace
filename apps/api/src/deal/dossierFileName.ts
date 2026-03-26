const MAX_SLUG_LENGTH = 48;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildDossierExportSlug(address: string | null | undefined): string {
  if (typeof address !== "string") return "PROPERTY";
  const slug = normalizeWhitespace(address)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug.toUpperCase() : "PROPERTY";
}

export function buildDossierPdfFileName(address: string | null | undefined): string {
  return `DEAL-DOSSIER-${buildDossierExportSlug(address)}.pdf`;
}

export function buildProFormaFileName(
  address: string | null | undefined,
  date: Date = new Date()
): string {
  const dateStr = date.toISOString().slice(0, 10);
  return `PRO-FORMA-${buildDossierExportSlug(address)}-${dateStr}.xlsx`;
}
