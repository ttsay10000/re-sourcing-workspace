import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { getPool, UserProfileRepo } from "@re-sourcing/db";

const scryptAsync = promisify(scrypt);

const DEFAULT_SITE_PASSWORD = process.env.DEFAULT_SITE_PASSWORD?.trim() || "Whatagloriousday!1";
const SITE_AUTH_SESSION_SECRET =
  process.env.SITE_AUTH_SESSION_SECRET?.trim()
  || process.env.CRON_SECRET?.trim()
  || "re-sourcing-site-auth-session-secret";
const SITE_AUTH_COOKIE_NAME = "re_sourcing_site_session";
const SITE_AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

type SessionVerificationResult =
  | {
      valid: true;
      expiresAtMs: number;
      profileId: string;
    }
  | {
      valid: false;
    };

function getCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  const sameSite: "lax" | "none" = secure ? "none" : "lax";
  return {
    httpOnly: true,
    maxAge: SITE_AUTH_SESSION_TTL_MS,
    path: "/",
    sameSite,
    secure,
  };
}

function getClearCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  const sameSite: "lax" | "none" = secure ? "none" : "lax";
  return {
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
  };
}

function signSessionPayload(payload: string): string {
  return createHmac("sha256", SITE_AUTH_SESSION_SECRET).update(payload).digest("hex");
}

function safeCompareStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const chunk of header.split(";")) {
    const cookie = chunk.trim();
    if (!cookie.startsWith(prefix)) continue;
    const value = cookie.slice(prefix.length);
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

async function getDefaultSiteAuthRow(): Promise<{ id: string; sitePasswordHash: string }> {
  const pool = getPool();
  const profileRepo = new UserProfileRepo({ pool });
  const id = await profileRepo.ensureDefault();
  const result = await pool.query<{ id: string; site_password_hash: string | null }>(
    `SELECT id, site_password_hash
       FROM user_profile
      WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Default user profile is not available.");

  if (typeof row.site_password_hash === "string" && row.site_password_hash.trim().length > 0) {
    return { id: row.id, sitePasswordHash: row.site_password_hash };
  }

  const seededHash = await hashSitePassword(DEFAULT_SITE_PASSWORD);
  await pool.query(
    `UPDATE user_profile
        SET site_password_hash = $2,
            site_password_updated_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [id, seededHash]
  );
  return { id, sitePasswordHash: seededHash };
}

export async function hashSitePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifySitePasswordHash(storedHash: string, password: string): Promise<boolean> {
  const [prefix, salt, expectedHex] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !expectedHex) return false;
  const derivedKey = (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return safeCompareStrings(derivedKey.toString("hex"), expectedHex);
}

export async function verifyDefaultSitePassword(password: string): Promise<{ ok: boolean; profileId: string | null }> {
  const normalizedPassword = password.trim();
  if (!normalizedPassword) return { ok: false, profileId: null };
  const authRow = await getDefaultSiteAuthRow();
  const ok = await verifySitePasswordHash(authRow.sitePasswordHash, normalizedPassword);
  return { ok, profileId: ok ? authRow.id : null };
}

export async function updateDefaultSitePassword(nextPassword: string): Promise<string> {
  const normalizedPassword = nextPassword.trim();
  if (!normalizedPassword) throw new Error("Site password cannot be empty.");
  const authRow = await getDefaultSiteAuthRow();
  const nextHash = await hashSitePassword(normalizedPassword);
  const pool = getPool();
  await pool.query(
    `UPDATE user_profile
        SET site_password_hash = $2,
            site_password_updated_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [authRow.id, nextHash]
  );
  return authRow.id;
}

export function createSiteAuthSessionToken(
  profileId: string,
  options?: { nowMs?: number; ttlMs?: number }
): string {
  const nowMs = options?.nowMs ?? Date.now();
  const ttlMs = options?.ttlMs ?? SITE_AUTH_SESSION_TTL_MS;
  const expiresAtMs = nowMs + ttlMs;
  const nonce = randomBytes(12).toString("hex");
  const payload = `${profileId}.${nowMs}.${expiresAtMs}.${nonce}`;
  const signature = signSessionPayload(payload);
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

export function verifySiteAuthSessionToken(
  token: string,
  options?: { nowMs?: number }
): SessionVerificationResult {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const [profileId, issuedAtRaw, expiresAtRaw, nonce, signature] = raw.split(".");
    if (!profileId || !issuedAtRaw || !expiresAtRaw || !nonce || !signature) {
      return { valid: false };
    }

    const issuedAtMs = Number(issuedAtRaw);
    const expiresAtMs = Number(expiresAtRaw);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
      return { valid: false };
    }

    const expectedSignature = signSessionPayload(`${profileId}.${issuedAtRaw}.${expiresAtRaw}.${nonce}`);
    if (!safeCompareStrings(signature, expectedSignature)) {
      return { valid: false };
    }

    const nowMs = options?.nowMs ?? Date.now();
    if (expiresAtMs <= nowMs) return { valid: false };

    return { valid: true, expiresAtMs, profileId };
  } catch {
    return { valid: false };
  }
}

export function readSiteAuthSessionToken(req: Request): string | null {
  const bearerHeader = req.headers.authorization;
  if (typeof bearerHeader === "string" && bearerHeader.startsWith("Bearer ")) {
    const token = bearerHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return parseCookie(req.headers.cookie, SITE_AUTH_COOKIE_NAME);
}

export function setSiteAuthSessionCookie(res: Response, profileId: string): void {
  res.cookie(SITE_AUTH_COOKIE_NAME, createSiteAuthSessionToken(profileId), getCookieOptions());
}

export function clearSiteAuthSessionCookie(res: Response): void {
  res.clearCookie(SITE_AUTH_COOKIE_NAME, getClearCookieOptions());
}

export function requireSiteAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readSiteAuthSessionToken(req);
  if (!token) {
    clearSiteAuthSessionCookie(res);
    res.status(401).json({ error: "Site password required." });
    return;
  }

  const verification = verifySiteAuthSessionToken(token);
  if (!verification.valid) {
    clearSiteAuthSessionCookie(res);
    res.status(401).json({ error: "Site password required." });
    return;
  }

  next();
}
