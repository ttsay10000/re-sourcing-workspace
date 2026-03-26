import { describe, expect, it } from "vitest";
import {
  buildDossierExportSlug,
  buildDossierPdfFileName,
  buildProFormaFileName,
} from "./dossierFileName.js";

describe("dossierFileName", () => {
  it("slugifies the address into an uppercase export token", () => {
    expect(buildDossierExportSlug("248 East 32nd Street, New York, NY 10016")).toBe(
      "248-EAST-32ND-STREET-NEW-YORK-NY-10016"
    );
  });

  it("falls back safely when the address is blank", () => {
    expect(buildDossierPdfFileName("   ")).toBe("DEAL-DOSSIER-PROPERTY.pdf");
  });

  it("builds the PDF and pro forma file names consistently", () => {
    const date = new Date("2026-03-26T12:00:00.000Z");
    expect(buildDossierPdfFileName("248 E 32nd St")).toBe("DEAL-DOSSIER-248-E-32ND-ST.pdf");
    expect(buildProFormaFileName("248 E 32nd St", date)).toBe(
      "PRO-FORMA-248-E-32ND-ST-2026-03-26.xlsx"
    );
  });
});
