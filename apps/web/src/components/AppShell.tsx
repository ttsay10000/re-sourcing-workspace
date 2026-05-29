"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type NavLink = {
  href: string;
  label: string;
  shortLabel: string;
  matches: (pathname: string, section: string | null) => boolean;
};

const NAV_LINKS: NavLink[] = [
  {
    href: "/",
    label: "Home",
    shortLabel: "H",
    matches: (pathname: string) => pathname === "/",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    shortLabel: "P",
    matches: (pathname: string) =>
      pathname === "/pipeline" ||
      pathname.startsWith("/pipeline/") ||
      pathname === "/property-data" ||
      pathname.startsWith("/property-data/") ||
      pathname.startsWith("/property/"),
  },
  {
    href: "/crm",
    label: "Broker CRM",
    shortLabel: "B",
    matches: (pathname: string) =>
      pathname === "/crm" ||
      pathname.startsWith("/crm/") ||
      pathname === "/om-review" ||
      pathname.startsWith("/om-review/"),
  },
  {
    href: "/saved",
    label: "Saved Deals",
    shortLabel: "S",
    matches: (pathname: string, section: string | null) =>
      pathname === "/saved" ||
      pathname.startsWith("/saved/") ||
      ((pathname === "/profile" || pathname.startsWith("/profile/")) && section === "saved-deals"),
  },
  {
    href: "/progress",
    label: "Deal Progress",
    shortLabel: "D",
    matches: (pathname: string) =>
      pathname === "/progress" ||
      pathname.startsWith("/progress/") ||
      pathname === "/deal-analysis" ||
      pathname.startsWith("/deal-analysis/") ||
      pathname.startsWith("/dossier-") ||
      pathname.startsWith("/rental-analysis"),
  },
  {
    href: "/profile",
    label: "Profile",
    shortLabel: "U",
    matches: (pathname: string, section: string | null) =>
      (pathname === "/profile" || pathname.startsWith("/profile/") || pathname === "/profiles") &&
      section !== "saved-deals",
  },
];
const ROOT_REDIRECT_PATH = "/pipeline";
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
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [locking, setLocking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [currentSection, setCurrentSection] = useState<string | null>(null);

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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const syncSidebarState = () => setSidebarCollapsed(media.matches);

    syncSidebarState();
    media.addEventListener("change", syncSidebarState);
    return () => media.removeEventListener("change", syncSidebarState);
  }, []);

  useEffect(() => {
    const syncUrlState = () => {
      const params = new URLSearchParams(window.location.search);
      setGlobalSearch(params.get("q") ?? "");
      setCurrentSection(params.get("section"));
    };

    syncUrlState();
    window.addEventListener("popstate", syncUrlState);
    return () => window.removeEventListener("popstate", syncUrlState);
  }, [pathname]);

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

  useEffect(() => {
    if (authStatus !== "authenticated" || pathname !== "/") return;
    router.replace(`${ROOT_REDIRECT_PATH}${window.location.search}${window.location.hash}`);
  }, [authStatus, pathname, router]);

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

  const updateGlobalSearch = useCallback(
    (nextValue: string) => {
      setGlobalSearch(nextValue);

      const params = new URLSearchParams(window.location.search);
      if (nextValue.trim()) {
        params.set("q", nextValue);
      } else {
        params.delete("q");
      }

      const nextQuery = params.toString();
      const hash = window.location.hash;
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash}`, { scroll: false });
    },
    [pathname, router]
  );

  const clearGlobalSearch = useCallback(() => {
    updateGlobalSearch("");
  }, [updateGlobalSearch]);

  const handleNavClick = useCallback((href: string) => {
    const targetUrl = new URL(href, window.location.origin);
    setCurrentSection(targetUrl.searchParams.get("section"));
    setGlobalSearch(targetUrl.searchParams.get("q") ?? "");
  }, []);

  if (authStatus !== "authenticated") {
    return (
      <main className="site-auth-screen">
        <section className="site-auth-card">
          <p className="site-auth-eyebrow">Protected workspace</p>
          <h1 className="site-auth-title">Real Estate Sourcing Flow</h1>
          <p className="site-auth-copy">
            Enter the shared site password to open the pipeline, broker CRM, saved deals, progress, and profile settings.
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
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <Link href="/" className="app-sidebar-brand" aria-label="Real Estate Sourcing Flow home">
          <span className="app-sidebar-mark">RE</span>
          <span className="app-sidebar-brand-text">
            <span>Sourcing Flow</span>
            <small>Workspace</small>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Primary navigation">
          {NAV_LINKS.map((navItem) => {
            const isActive = navItem.matches(pathname, currentSection);
            return (
              <Link
                key={navItem.href}
                href={navItem.href}
                aria-label={navItem.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => handleNavClick(navItem.href)}
                className={`app-nav-link ${isActive ? "app-nav-link--active" : ""}`}
              >
                <span className="app-nav-short" aria-hidden="true">
                  {navItem.shortLabel}
                </span>
                <span className="app-nav-label">{navItem.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-foot">
          <button
            type="button"
            className="app-sidebar-lock-button"
            onClick={handleLock}
            disabled={locking}
          >
            {locking ? "Locking…" : "Lock"}
          </button>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <button
            type="button"
            className="app-icon-button app-sidebar-toggle"
            aria-label={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
            aria-pressed={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <span className="app-sidebar-toggle-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>

          <div className="app-global-search" role="search">
            <span className="app-global-search-icon" aria-hidden="true" />
            <input
              type="search"
              value={globalSearch}
              onChange={(event) => updateGlobalSearch(event.target.value)}
              placeholder="Search current page"
              aria-label="Search current page"
              className="app-global-search-input"
            />
            {globalSearch ? (
              <button
                type="button"
                className="app-global-search-clear"
                onClick={clearGlobalSearch}
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="app-topbar-actions">
            <span className="app-session-pill">Site unlocked</span>
            <Link href="/add-property" className="app-primary-action">
              Import / Add Property
            </Link>
          </div>
        </header>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
