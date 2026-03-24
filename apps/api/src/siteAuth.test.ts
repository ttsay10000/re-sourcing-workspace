import { describe, expect, it } from "vitest";
import {
  createSiteAuthSessionToken,
  hashSitePassword,
  verifySiteAuthSessionToken,
  verifySitePasswordHash,
} from "./siteAuth.js";

describe("siteAuth", () => {
  it("hashes and verifies shared passwords", async () => {
    const hash = await hashSitePassword("Whatagloriousday!1");

    await expect(verifySitePasswordHash(hash, "Whatagloriousday!1")).resolves.toBe(true);
    await expect(verifySitePasswordHash(hash, "wrong-password")).resolves.toBe(false);
  });

  it("round-trips signed session tokens", () => {
    const token = createSiteAuthSessionToken("profile-1", { nowMs: 1_000, ttlMs: 10_000 });
    const verification = verifySiteAuthSessionToken(token, { nowMs: 5_000 });

    expect(verification.valid).toBe(true);
    if (!verification.valid) return;
    expect(verification.profileId).toBe("profile-1");
    expect(verification.expiresAtMs).toBe(11_000);
  });

  it("rejects tampered or expired session tokens", () => {
    const token = createSiteAuthSessionToken("profile-1", { nowMs: 1_000, ttlMs: 10_000 });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(verifySiteAuthSessionToken(tampered, { nowMs: 5_000 }).valid).toBe(false);
    expect(verifySiteAuthSessionToken(token, { nowMs: 12_000 }).valid).toBe(false);
  });
});
