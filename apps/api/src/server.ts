/**
 * Express API server: health, CORS, optional DATABASE_URL.
 * Starts even if DB is empty; health does not require DB.
 */

import express from "express";
import cors from "cors";
import type { HealthResponse } from "@re-sourcing/contracts";
import testAgentRouter from "./routes/testAgent.js";
import listingsRouter from "./routes/listings.js";
import propertiesRouter from "./routes/properties.js";
import cronRouter from "./routes/cron.js";
import profileRouter from "./routes/profile.js";
import dossierRouter from "./routes/dossier.js";

const PORT = Number(process.env.PORT) || 4000;
const version = process.env.npm_package_version || "1.0.0";
const env = process.env.NODE_ENV || "development";

const app = express();

// CORS: allow web app origin(s)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : ["http://localhost:3000", "http://127.0.0.1:3000"];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json());

// Root: avoid "Cannot GET /" when opening API URL in browser
app.get("/", (_req, res) => {
  res.json({
    service: "re-sourcing-api",
    message: "Use the web app URL for the UI (e.g. re-sourcing-web.onrender.com).",
    health: "/api/health",
  });
});

// Health: no DB required
app.get("/api/health", (_req, res) => {
  const body: HealthResponse = { ok: true, version, env };
  res.json(body);
});

app.use("/api", testAgentRouter);
app.use("/api", listingsRouter);
app.use("/api", propertiesRouter);
app.use("/api", profileRouter);
app.use("/api", dossierRouter);
app.use("/api", cronRouter);

// Optional: read DATABASE_URL for future routes; do not connect at startup
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  console.log("[api] DATABASE_URL is set (DB available for routes).");
} else {
  console.log("[api] DATABASE_URL not set; server runs without DB.");
}

export function start(): void {
  app.listen(PORT, () => {
    console.log(`[api] listening on port ${PORT} (env=${env})`);
  });
}
