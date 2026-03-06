"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/runs", label: "Runs" },
  { href: "/property-data", label: "Property Data" },
  { href: "/dossier-assumptions", label: "Dossier" },
  { href: "/rental-analysis", label: "Rental Analysis" },
  { href: "/deal-analysis", label: "Deal Analysis" },
  { href: "/profile", label: "Profile" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
          <span className="app-user-profile">User Profile</span>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
