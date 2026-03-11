"use client";

import Link from "next/link";

export default function AgentTestPage() {
  return (
    <>
      <h1 className="page-title">StreetEasy Agent</h1>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p>
          The two-step NYC Real Estate API flow (GET Active Sales → GET Sale details by URL) now
          runs from the <strong>StreetEasy Agent</strong> page.
        </p>
        <p style={{ marginTop: "0.75rem" }}>
          <Link href="/runs" className="btn-primary" style={{ display: "inline-block" }}>
            Go to StreetEasy Agent
          </Link>
        </p>
      </div>
    </>
  );
}
