import { Router, type Request, type Response } from "express";
import {
  clearSiteAuthSessionCookie,
  isSiteAuthRequired,
  readSiteAuthSessionToken,
  setSiteAuthSessionCookie,
  verifyDefaultSitePassword,
  verifySiteAuthSessionToken,
} from "../siteAuth.js";

const router = Router();

router.get("/site-auth/status", (req: Request, res: Response) => {
  if (!isSiteAuthRequired()) {
    res.json({ authenticated: true, authRequired: false });
    return;
  }

  const token = readSiteAuthSessionToken(req);
  if (!token) {
    clearSiteAuthSessionCookie(res);
    res.status(401).json({ authenticated: false, authRequired: true });
    return;
  }

  const verification = verifySiteAuthSessionToken(token);
  if (!verification.valid) {
    clearSiteAuthSessionCookie(res);
    res.status(401).json({ authenticated: false, authRequired: true });
    return;
  }

  res.json({
    authenticated: true,
    authRequired: true,
    expiresAt: new Date(verification.expiresAtMs).toISOString(),
  });
});

router.post("/site-auth/session", async (req: Request, res: Response) => {
  try {
    if (!isSiteAuthRequired()) {
      res.json({ authenticated: true, authRequired: false });
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const verification = await verifyDefaultSitePassword(password);
    if (!verification.ok || !verification.profileId) {
      clearSiteAuthSessionCookie(res);
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    setSiteAuthSessionCookie(res, verification.profileId);
    res.json({ authenticated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[site-auth session create]", err);
    res.status(503).json({ error: "Failed to unlock the site.", details: message });
  }
});

router.delete("/site-auth/session", (_req: Request, res: Response) => {
  const authRequired = isSiteAuthRequired();
  clearSiteAuthSessionCookie(res);
  res.json({
    authenticated: !authRequired,
    authRequired,
  });
});

export default router;
