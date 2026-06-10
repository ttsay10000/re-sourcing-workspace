"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bookmark,
  Building2,
  Contact,
  FileText,
  History,
  Home,
  KanbanSquare,
  Menu,
  Newspaper,
  Plus,
  Scale,
  Search,
  Upload,
  User,
  X,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import { ProcessBannerProvider, ProcessBannerViewport } from "./ProcessBanner";

type NavChildLink = {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
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
    icon: Home,
    matches: (pathname: string) => pathname === "/",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    shortLabel: "P",
    icon: Building2,
    matches: (pathname: string) =>
      pathname === "/pipeline" ||
      pathname.startsWith("/pipeline/") ||
      pathname === "/property-data" ||
      pathname.startsWith("/property-data/") ||
      pathname.startsWith("/property/"),
    children: [
      {
        href: "/pipeline",
        label: "Pipeline",
        shortLabel: "P",
        icon: Building2,
        matches: (pathname: string) =>
          (pathname === "/pipeline" ||
            pathname === "/property-data" ||
            pathname.startsWith("/property-data/") ||
            pathname.startsWith("/property/")) &&
          !pathname.startsWith("/pipeline/yield-map") &&
          !pathname.startsWith("/pipeline/comp-analysis") &&
          !pathname.startsWith("/pipeline/market-docs"),
      },
      {
        href: "/pipeline/yield-map",
        label: "Yield Map",
        shortLabel: "Y",
        icon: MapIcon,
        matches: (pathname: string) => pathname.startsWith("/pipeline/yield-map"),
      },
      {
        href: "/pipeline/comp-analysis",
        label: "Comp Analysis",
        shortLabel: "C",
        icon: Scale,
        matches: (pathname: string) => pathname.startsWith("/pipeline/comp-analysis"),
      },
      {
        href: "/pipeline/market-docs",
        label: "Market Docs",
        shortLabel: "M",
        icon: Newspaper,
        matches: (pathname: string) => pathname.startsWith("/pipeline/market-docs"),
      },
    ],
  },
  {
    href: "/crm",
    label: "Broker CRM",
    shortLabel: "B",
    icon: Contact,
    matches: (pathname: string) =>
      pathname === "/crm" ||
      pathname.startsWith("/crm/") ||
      pathname === "/om-review" ||
      pathname.startsWith("/om-review/") ||
      pathname === "/broker-om" ||
      pathname.startsWith("/broker-om/"),
    children: [
      {
        href: "/crm",
        label: "CRM",
        shortLabel: "C",
        icon: Contact,
        matches: (pathname: string) => pathname === "/crm" || pathname.startsWith("/crm/"),
      },
      {
        href: "/om-review",
        label: "Review Queue",
        shortLabel: "R",
        icon: FileText,
        matches: (pathname: string) => pathname === "/om-review" || pathname.startsWith("/om-review/"),
      },
      {
        href: "/broker-om/email-search",
        label: "Find OMs in Email",
        shortLabel: "F",
        icon: Search,
        matches: (pathname: string) => pathname === "/broker-om/email-search",
      },
    ],
  },
  {
    href: "/progress",
    label: "Deal Progress",
    shortLabel: "D",
    icon: KanbanSquare,
    matches: (pathname: string) =>
      pathname === "/progress" ||
      pathname.startsWith("/progress/") ||
      pathname === "/deal-analysis" ||
      pathname.startsWith("/deal-analysis/") ||
      pathname === "/activity" ||
      pathname.startsWith("/activity/") ||
      pathname.startsWith("/dossier-"),
    children: [
      {
        href: "/progress",
        label: "Progress Board",
        shortLabel: "B",
        icon: KanbanSquare,
        matches: (pathname: string) => pathname === "/progress" || pathname.startsWith("/progress/"),
      },
      {
        href: "/deal-analysis",
        label: "OM Workspace",
        shortLabel: "O",
        icon: FileText,
        matches: (pathname: string) => pathname === "/deal-analysis" || pathname.startsWith("/deal-analysis/"),
      },
      {
        href: "/activity",
        label: "Activity Log",
        shortLabel: "A",
        icon: History,
        matches: (pathname: string) => pathname === "/activity" || pathname.startsWith("/activity/"),
      },
    ],
  },
  {
    href: "/profile",
    label: "Profile",
    shortLabel: "U",
    icon: User,
    matches: (pathname: string) =>
      pathname === "/profile" || pathname.startsWith("/profile/"),
  },
  {
    href: "/saved",
    label: "Saved Deals",
    shortLabel: "S",
    icon: Bookmark,
    matches: (pathname: string) =>
      pathname === "/saved" || pathname.startsWith("/saved/"),
  },
];

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
    <ProcessBannerProvider>
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <Link href="/" className="app-sidebar-brand" aria-label="Sourcing OS home">
          <span className="app-sidebar-mark" aria-hidden="true">
            <Image
              src="/sourcing-os-mark.svg"
              alt=""
              width={30}
              height={30}
              className="app-sidebar-mark-image"
              priority
            />
          </span>
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
            const NavIcon = navItem.icon;
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
                  <span className="app-nav-icon" aria-hidden="true">
                    <NavIcon size={17} strokeWidth={1.85} />
                  </span>
                  <span className="app-nav-label">{navItem.label}</span>
                </Link>
                {navItem.children && isActive ? (
                  <div className="app-nav-children" aria-label={`${navItem.label} pages`}>
                    {navItem.children.map((child) => {
                      const isChildActive = child.matches(pathname, currentSection);
                      const ChildIcon = child.icon;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={isChildActive ? "page" : undefined}
                          onClick={() => handleNavClick(child.href)}
                          className={`app-nav-sublink ${isChildActive ? "app-nav-sublink--active" : ""}`}
                        >
                          <span className="app-nav-sublink-icon" aria-hidden="true">
                            <ChildIcon size={14} strokeWidth={1.85} />
                          </span>
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
            <Menu size={18} strokeWidth={1.85} aria-hidden="true" />
          </button>

          <div className="app-global-search" role="search">
            <span className="app-global-search-icon" aria-hidden="true">
              <Search size={17} strokeWidth={1.85} />
            </span>
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
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="app-topbar-actions">
            <Link href="/add-property" className="app-import-link">
              <Upload size={15} strokeWidth={1.85} aria-hidden="true" />
              <span>Import</span>
            </Link>
            <Link href="/add-property" className="app-primary-action">
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>Add property</span>
            </Link>
          </div>
        </header>

        <ProcessBannerViewport />
        <main className="app-main">{children}</main>
      </div>
    </div>
    </ProcessBannerProvider>
  );
}
