"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

type NavChildLink = {
  href: string;
  label: string;
  shortLabel: string;
  matches: (pathname: string, section: string | null) => boolean;
};

type NavLink = NavChildLink & {
  children?: NavChildLink[];
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
    children: [
      {
        href: "/progress",
        label: "Progress Board",
        shortLabel: "B",
        matches: (pathname: string) => pathname === "/progress" || pathname.startsWith("/progress/"),
      },
      {
        href: "/deal-analysis",
        label: "OM Workspace",
        shortLabel: "O",
        matches: (pathname: string) => pathname === "/deal-analysis" || pathname.startsWith("/deal-analysis/"),
      },
    ],
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
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [currentSection, setCurrentSection] = useState<string | null>(null);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = resolveRequestUrl(input);
      if (!isApiRequest(requestUrl)) return originalFetch(input, init);

      return originalFetch(input, {
        ...(init ?? {}),
        credentials: "include",
      });
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

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <Link href="/" className="app-sidebar-brand" aria-label="Real Estate Sourcing Flow home">
          <span className="app-sidebar-mark">SO</span>
          <span className="app-sidebar-brand-text">
            <span>Sourcing OS</span>
            <small>Manhattan MF</small>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Primary navigation">
          <span className="app-nav-section-label" aria-hidden="true">Workspace</span>
          {NAV_LINKS.map((navItem) => {
            const isActive = navItem.matches(pathname, currentSection);
            const childIsActive = navItem.children?.some((child) => child.matches(pathname, currentSection)) ?? false;
            return (
              <div
                key={navItem.href}
                className={`app-nav-group ${isActive ? "app-nav-group--active" : ""}`}
              >
                <Link
                  href={navItem.href}
                  aria-label={navItem.label}
                  aria-current={isActive && !childIsActive ? "page" : undefined}
                  onClick={() => handleNavClick(navItem.href)}
                  className={`app-nav-link ${isActive ? "app-nav-link--active" : ""}`}
                >
                  <span className="app-nav-short" aria-hidden="true">
                    {navItem.shortLabel}
                  </span>
                  <span className="app-nav-label">{navItem.label}</span>
                </Link>
                {navItem.children && isActive ? (
                  <div className="app-nav-children" aria-label={`${navItem.label} pages`}>
                    {navItem.children.map((child) => {
                      const isChildActive = child.matches(pathname, currentSection);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={isChildActive ? "page" : undefined}
                          onClick={() => handleNavClick(child.href)}
                          className={`app-nav-sublink ${isChildActive ? "app-nav-sublink--active" : ""}`}
                        >
                          <span className="app-nav-sublink-dot" aria-hidden="true" />
                          <span className="app-nav-sublink-label">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

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
            <Link href="/add-property" className="app-import-link">
              Import
            </Link>
            <Link href="/add-property" className="app-primary-action">
              Add property
            </Link>
          </div>
        </header>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
