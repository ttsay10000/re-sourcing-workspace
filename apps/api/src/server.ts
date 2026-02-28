/**
 * Express API server: health, CORS, optional DATABASE_URL.
 * Starts even if DB is empty; health does not require DB.
 */

import express from "express";
import cors from "cors";
import type { HealthResponse } from "@re-sourcing/contracts";
import testAgentRouter from "./routes/testAgent.js";
import listingsRouter from "./routes/listings.js";

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

// Health: no DB required
app.get("/api/health", (_req, res) => {
  const body: HealthResponse = { ok: true, version, env };
  res.json(body);
});

app.use("/api", testAgentRouter);
app.use("/api", listingsRouter);

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
