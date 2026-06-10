"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./yieldMap.module.css";
import type { NeighborhoodCollection } from "./geo";

export type MapPin = {
  propertyId: string;
  address: string;
  lat: number;
  lng: number;
  color: string;
  /** Stat lines shown in the popup under the address. */
  lines: string[];
};

/** Per-neighborhood aggregate rendered as a fill tint + a numeric badge at the label point. */
export type AreaStat = {
  code: string;
  name: string;
  borough: string;
  /** [lng, lat] badge anchor. */
  labelPoint: [number, number];
  count: number;
  medianYieldPct: number;
  /** Median of per-deal yield moves since first sourced; null when no deal has history yet. */
  medianDeltaPct: number | null;
  trend: "up" | "down" | "flat" | null;
  color: string;
};

// Keyless CARTO light raster — far quieter than default OSM tiles, so pins,
// boundaries, and badges carry the visual hierarchy. @2x keeps retina crisp.
const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["a", "b", "c", "d"].map(
        (subdomain) => `https://${subdomain}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`
      ),
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "basemap", type: "raster", source: "basemap" }],
};

const MANHATTAN_CENTER: [number, number] = [-73.978, 40.752];
const AREA_SOURCE = "neighborhoods";
const AREA_FILL_LAYER = "neighborhood-fill";
const AREA_LINE_LAYER = "neighborhood-line";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

function popupNode(pin: MapPin): HTMLElement {
  const root = document.createElement("div");
  root.className = styles.popup;

  const address = document.createElement("strong");
  address.textContent = pin.address;
  root.appendChild(address);

  for (const line of pin.lines) {
    const row = document.createElement("span");
    row.textContent = line;
    root.appendChild(row);
  }

  const link = document.createElement("a");
  link.href = `/pipeline?propertyId=${encodeURIComponent(pin.propertyId)}`;
  link.textContent = "Open in pipeline →";
  root.appendChild(link);

  return root;
}

const TREND_GLYPH: Record<NonNullable<AreaStat["trend"]>, string> = { up: "▲", down: "▼", flat: "–" };

function badgeNode(area: AreaStat): HTMLElement {
  const root = document.createElement("div");
  root.className = styles.areaBadge;
  root.style.borderColor = area.color;

  const name = document.createElement("span");
  name.className = styles.areaBadgeName;
  name.textContent = area.name;
  root.appendChild(name);

  const value = document.createElement("span");
  value.className = styles.areaBadgeValue;
  value.style.color = area.color;
  value.textContent = `${area.medianYieldPct.toFixed(2)}%`;
  if (area.trend) {
    const trend = document.createElement("span");
    trend.className =
      area.trend === "up" ? styles.trendUp : area.trend === "down" ? styles.trendDown : styles.trendFlat;
    trend.textContent = ` ${TREND_GLYPH[area.trend]}`;
    value.appendChild(trend);
  }
  root.appendChild(value);

  const deltaText =
    area.medianDeltaPct != null
      ? ` · Δ ${area.medianDeltaPct >= 0 ? "+" : ""}${area.medianDeltaPct.toFixed(2)}pp since first sourced`
      : "";
  root.title = `${area.name} (${area.borough}) — median ${area.medianYieldPct.toFixed(2)}% across ${area.count} mapped ${
    area.count === 1 ? "deal" : "deals"
  }${deltaText}`;
  return root;
}

/** Data-driven fill: tint each aggregated neighborhood with its yield-band color. */
function areaFillColor(areas: AreaStat[]): maplibregl.ExpressionSpecification | string {
  if (areas.length === 0) return TRANSPARENT;
  const branches = areas.flatMap((area) => [area.code, area.color]);
  return ["match", ["get", "code"], ...branches, TRANSPARENT] as unknown as maplibregl.ExpressionSpecification;
}

/**
 * MapLibre canvas: neighborhood delineations + median-yield badges under
 * one marker per geocoded comp, fit to the visible set.
 */
export function YieldMapCanvas({
  pins,
  boundaries,
  areas,
  showAreas,
}: {
  pins: MapPin[];
  boundaries: NeighborhoodCollection | null;
  areas: AreaStat[];
  showAreas: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const badgesRef = useRef<maplibregl.Marker[]>([]);
  const styleReadyRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE,
      center: MANHATTAN_CENTER,
      zoom: 11.6,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      styleReadyRef.current = true;
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      badgesRef.current.forEach((marker) => marker.remove());
      badgesRef.current = [];
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // Boundary polygons + yield fills (canvas layers, under the DOM markers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!boundaries) return;
      if (!map.getSource(AREA_SOURCE)) {
        map.addSource(AREA_SOURCE, { type: "geojson", data: boundaries as unknown as GeoJSON.GeoJSON });
        map.addLayer({
          id: AREA_FILL_LAYER,
          type: "fill",
          source: AREA_SOURCE,
          paint: { "fill-color": TRANSPARENT, "fill-opacity": 0.16 },
        });
        map.addLayer({
          id: AREA_LINE_LAYER,
          type: "line",
          source: AREA_SOURCE,
          paint: { "line-color": "#475569", "line-opacity": 0.32, "line-width": 1 },
        });
      }
      map.setPaintProperty(AREA_FILL_LAYER, "fill-color", areaFillColor(showAreas ? areas : []));
      const visibility = showAreas ? "visible" : "none";
      map.setLayoutProperty(AREA_FILL_LAYER, "visibility", visibility);
      map.setLayoutProperty(AREA_LINE_LAYER, "visibility", visibility);
    };

    if (styleReadyRef.current) {
      apply();
      return;
    }
    // Data arrived before the style finished loading — defer one tick past "load".
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [boundaries, areas, showAreas]);

  // Median-yield badges at neighborhood label points (DOM markers, under pins).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    badgesRef.current.forEach((marker) => marker.remove());
    badgesRef.current = showAreas
      ? areas.map((area) =>
          new maplibregl.Marker({ element: badgeNode(area) }).setLngLat(area.labelPoint).addTo(map)
        )
      : [];
  }, [areas, showAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = pins.map((pin) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = styles.pin;
      element.style.background = pin.color;
      element.setAttribute("aria-label", pin.address);
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "280px" }).setDOMContent(popupNode(pin));
      return new maplibregl.Marker({ element }).setLngLat([pin.lng, pin.lat]).setPopup(popup).addTo(map);
    });

    if (pins.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      pins.forEach((pin) => bounds.extend([pin.lng, pin.lat]));
      map.fitBounds(bounds, { padding: 56, maxZoom: 14.5, duration: 0 });
    }
  }, [pins]);

  return <div ref={containerRef} className={styles.mapCanvas} />;
}
