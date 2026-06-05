"use client";

import React from "react";
import { AlertCircle, CalendarDays, CheckCircle2, Circle, Info } from "lucide-react";

export type PropertyDetailTabId =
  | "overview"
  | "sources"
  | "documents"
  | "enrichment"
  | "omWorkspace"
  | "marketComps"
  | "underwriting"
  | "outreach"
  | "dossierScore"
  | "activity";

export interface PropertyDetailTabItem {
  id: PropertyDetailTabId;
  label: string;
  badge?: string | number | null;
}

export interface PropertyDetailRailItem {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "neutral" | "good" | "warn" | "danger";
}

export interface PropertyDetailActivityItem {
  label: string;
  detail?: string | null;
  tone?: "neutral" | "good" | "warn" | "danger";
}

interface PropertyDetailWorkspaceProps {
  tabs: PropertyDetailTabItem[];
  activeTab: PropertyDetailTabId;
  onTabChange: (tab: PropertyDetailTabId) => void;
  railItems: PropertyDetailRailItem[];
  activityItems?: PropertyDetailActivityItem[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PropertyDetailWorkspace({
  tabs,
  activeTab,
  onTabChange,
  railItems,
  activityItems = [],
  actions,
  children,
}: PropertyDetailWorkspaceProps) {
  const statusIcon = (tone: PropertyDetailRailItem["tone"]) => {
    if (tone === "good") return <CheckCircle2 size={14} strokeWidth={1.9} />;
    if (tone === "warn") return <AlertCircle size={14} strokeWidth={1.9} />;
    if (tone === "danger") return <AlertCircle size={14} strokeWidth={1.9} />;
    return <Circle size={13} strokeWidth={1.9} />;
  };

  return (
    <div className="property-detail-workspace">
      <div className="property-detail-workspace-top">
        <div className="property-detail-tabs" role="tablist" aria-label="Property detail sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`property-detail-tab ${activeTab === tab.id ? "property-detail-tab--active" : ""}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.badge != null && tab.badge !== "" ? (
                <span className="property-detail-tab-badge">{tab.badge}</span>
              ) : null}
            </button>
          ))}
        </div>

        {actions ? (
          <div className="property-detail-workspace-actions" aria-label="Property quick actions">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="property-detail-workspace-grid">
        <div className="property-detail-workspace-main" role="tabpanel">
          {children}
        </div>

        <aside className="property-detail-action-rail" aria-label="Property status and actions">
          <div className="property-detail-rail-heading">Status</div>
          <div className="property-detail-rail-list">
            {railItems.map((item) => (
              <div
                key={item.label}
                className={`property-detail-rail-item property-detail-rail-item--${item.tone ?? "neutral"}`}
              >
                <span className="property-detail-rail-icon" aria-hidden="true">{statusIcon(item.tone)}</span>
                <span className="property-detail-rail-copy">
                  <span className="property-detail-rail-label">{item.label}</span>
                  <strong className="property-detail-rail-value">{item.value}</strong>
                  {item.detail ? <span className="property-detail-rail-detail">{item.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="property-detail-rail-heading">Recent activity</div>
          <div className="property-detail-activity-list">
            {activityItems.length > 0 ? (
              activityItems.map((item) => (
                <div
                  key={`${item.label}-${item.detail ?? ""}`}
                  className={`property-detail-activity-item property-detail-activity-item--${item.tone ?? "neutral"}`}
                >
                  <CalendarDays className="property-detail-activity-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span className="property-detail-activity-copy">
                    <strong>{item.label}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </span>
                </div>
              ))
            ) : (
              <div className="property-detail-activity-empty">
                <Info size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>No recent activity yet.</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
