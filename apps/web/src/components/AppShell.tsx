"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/runs", label: "StreetEasy Agent" },
  { href: "/property-data", label: "Property Data" },
  { href: "/profile", label: "Profile" },
] as const;
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

type AuthStatus = "checking" | "locked" | "unlocking" | "authenticated";

function resolveRequestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

function isApiRequest(url: string | null): boolean {
  if (!url) return false;
  return url === API_BASE || url.startsWith(`${API_BASE}/`);
}

function isSiteAuthRequest(url: string | null): boolean {
  if (!url) return false;
  return url === `${API_BASE}/api/site-auth/status` || url === `${API_BASE}/api/site-auth/session`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = resolveRequestUrl(input);
      if (!isApiRequest(requestUrl)) return originalFetch(input, init);

      const response = await originalFetch(input, {
        ...(init ?? {}),
        credentials: "include",
      });

      if (response.status === 401 && !isSiteAuthRequest(requestUrl)) {
        setAuthError("Your unlock session expired. Enter the shared site password again.");
        setAuthStatus("locked");
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const checkSiteAuth = useCallback(async () => {
    setAuthError(null);
    try {
      const response = await fetch(`${API_BASE}/api/site-auth/status`, { credentials: "include" });
      if (!response.ok) {
        setAuthStatus("locked");
        return;
      }

      setAuthStatus("authenticated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reach the API";
      setAuthError(message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}.` : message);
      setAuthStatus("locked");
    }
  }, []);

  useEffect(() => {
    void checkSiteAuth();
  }, [checkSiteAuth]);

  const handleUnlock = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!password.trim()) {
        setAuthError("Enter the shared site password to continue.");
        setAuthStatus("locked");
        return;
      }

      setAuthStatus("unlocking");
      setAuthError(null);

      try {
        const response = await fetch(`${API_BASE}/api/site-auth/session`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          setAuthError(data?.error || data?.details || "Incorrect password.");
          setAuthStatus("locked");
          return;
        }

        setPassword("");
        setAuthStatus("authenticated");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unlock the site";
        setAuthError(message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}.` : message);
        setAuthStatus("locked");
      }
    },
    [password]
  );

  const handleLock = useCallback(async () => {
    setLocking(true);
    try {
      await fetch(`${API_BASE}/api/site-auth/session`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      // Keep the UI responsive even if the API call fails.
    } finally {
      setPassword("");
      setAuthError(null);
      setAuthStatus("locked");
      setLocking(false);
    }
  }, []);

  if (authStatus !== "authenticated") {
    return (
      <main className="site-auth-screen">
        <section className="site-auth-card">
          <p className="site-auth-eyebrow">Protected workspace</p>
          <h1 className="site-auth-title">Real Estate Sourcing Flow</h1>
          <p className="site-auth-copy">
            Enter the shared site password to open listings, property data, dossiers, and profile settings.
          </p>
          <form className="site-auth-form" onSubmit={handleUnlock}>
            <label className="profile-field">
              <span>Site password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="profile-input site-auth-input"
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {authError && <p className="site-auth-error">{authError}</p>}
            <div className="site-auth-actions">
              <button
                type="submit"
                className="profile-primary-button"
                disabled={authStatus === "checking" || authStatus === "unlocking"}
              >
                {authStatus === "checking"
                  ? "Checking access…"
                  : authStatus === "unlocking"
                    ? "Unlocking…"
                    : "Unlock site"}
              </button>
              <span className="site-auth-note">This is a single shared password for the whole workspace.</span>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">Real Estate Sourcing Flow</div>
        <nav className="app-nav">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`app-nav-link ${isActive ? "app-nav-link--active" : ""}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="app-header-right">
          <span className="app-user-profile">Site unlocked</span>
          <button
            type="button"
            className="app-header-lock-button"
            onClick={handleLock}
            disabled={locking}
          >
            {locking ? "Locking…" : "Lock"}
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <nav className="app-footer-nav" aria-label="Footer navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} className="app-footer-link">
              {label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
