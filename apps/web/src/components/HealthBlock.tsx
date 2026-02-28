"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface HealthResponse {
  ok: boolean;
  version: string;
  env: string;
}

export function HealthBlock() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message || "Failed to fetch"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading health…</div>;
  if (error) return <div className="card error">Error: {error}</div>;
  return (
    <div className="card">
      <p className={data?.ok ? "success" : ""}>
        API health: {data?.ok ? "OK" : "Not OK"}
      </p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
