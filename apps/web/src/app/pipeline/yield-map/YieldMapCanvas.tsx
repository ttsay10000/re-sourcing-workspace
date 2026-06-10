"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./yieldMap.module.css";
import type { NeighborhoodCollection } from "./geo";

export type MapPin = {
  /** Unique across deals AND comps (deals use propertyId, comps use comp:<itemId>). */
  id: string;
  /** Subject property to open for this pin (the comp's subject for comps). */
  propertyId: string;
  kind: "deal" | "comp";
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
  /** Formatted metric for the badge, e.g. "5.43%" or "$612/SF". */
  valueLabel: string;
  /** Hover tooltip for the badge. */
  titleLabel: string;
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

  if (pin.kind === "comp") {
    const tag = document.createElement("span");
    tag.className = styles.popupCompTag;
    tag.textContent = "Comp";
    root.appendChild(tag);
  }

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
  link.textContent = pin.kind === "comp" ? "Open subject deal →" : "Open in pipeline →";
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
  value.textContent = area.valueLabel;
  if (area.trend) {
    const trend = document.createElement("span");
    trend.className =
      area.trend === "up" ? styles.trendUp : area.trend === "down" ? styles.trendDown : styles.trendFlat;
    trend.textContent = ` ${TREND_GLYPH[area.trend]}`;
    value.appendChild(trend);
  }
  root.appendChild(value);

  root.title = area.titleLabel;
  return root;
}

/** Data-driven fill: tint each aggregated neighborhood with its metric-band color. */
function areaFillColor(areas: AreaStat[]): maplibregl.ExpressionSpecification | string {
  if (areas.length === 0) return TRANSPARENT;
  const branches = areas.flatMap((area) => [area.code, area.color]);
  return ["match", ["get", "code"], ...branches, TRANSPARENT] as unknown as maplibregl.ExpressionSpecification;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  element: HTMLElement;
  popup: maplibregl.Popup;
}

/**
 * MapLibre canvas: neighborhood delineations + metric badges under one marker
 * per geocoded deal (dots) and comp (diamonds), fit to the visible set.
 * Popups open on hover (sticky on click); `highlightedId` enlarges a pin so
 * table-row hover can point at the map.
 */
export function YieldMapCanvas({
  pins,
  boundaries,
  areas,
  showAreas,
  highlightedId,
  onPinHover,
}: {
  pins: MapPin[];
  boundaries: NeighborhoodCollection | null;
  areas: AreaStat[];
  showAreas: boolean;
  highlightedId?: string | null;
  onPinHover?: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const badgesRef = useRef<maplibregl.Marker[]>([]);
  const styleReadyRef = useRef(false);
  const lastFitKeyRef = useRef<string>("");
  const onPinHoverRef = useRef(onPinHover);
  onPinHoverRef.current = onPinHover;

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
      markersRef.current.forEach((entry) => {
        entry.popup.remove();
        entry.marker.remove();
      });
      markersRef.current.clear();
      badgesRef.current.forEach((marker) => marker.remove());
      badgesRef.current = [];
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // Boundary polygons + metric fills (canvas layers, under the DOM markers).
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

  // Metric badges at neighborhood label points (DOM markers, under pins).
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
    markersRef.current.forEach((entry) => {
      entry.popup.remove();
      entry.marker.remove();
    });
    markersRef.current.clear();

    for (const pin of pins) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = pin.kind === "comp" ? `${styles.pin} ${styles.pinComp}` : styles.pin;
      element.style.background = pin.color;
      element.setAttribute("aria-label", pin.kind === "comp" ? `Comp: ${pin.address}` : pin.address);

      const popup = new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "300px" })
        .setDOMContent(popupNode(pin))
        .setLngLat([pin.lng, pin.lat]);

      // Hover shows the popup; click pins it open until the next map click.
      let sticky = false;
      popup.on("close", () => {
        sticky = false;
      });
      element.addEventListener("mouseenter", () => {
        onPinHoverRef.current?.(pin.id);
        if (!popup.isOpen()) popup.addTo(map);
      });
      element.addEventListener("mouseleave", () => {
        onPinHoverRef.current?.(null);
        if (!sticky) popup.remove();
      });
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        sticky = !sticky;
        if (sticky && !popup.isOpen()) popup.addTo(map);
        if (!sticky) popup.remove();
      });

      const marker = new maplibregl.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map);
      markersRef.current.set(pin.id, { marker, element, popup });
    }

    // Refit only when the visible set changes — recoloring shouldn't move the camera.
    const fitKey = pins
      .map((pin) => pin.id)
      .sort()
      .join("|");
    if (pins.length > 0 && fitKey !== lastFitKeyRef.current) {
      lastFitKeyRef.current = fitKey;
      const bounds = new maplibregl.LngLatBounds();
      pins.forEach((pin) => bounds.extend([pin.lng, pin.lat]));
      map.fitBounds(bounds, { padding: 56, maxZoom: 14.5, duration: 0 });
    }
  }, [pins]);

  // Table-row hover → enlarge + ring the matching pin.
  useEffect(() => {
    markersRef.current.forEach((entry, id) => {
      const highlighted = id === highlightedId;
      entry.element.classList.toggle(styles.pinHighlighted, highlighted);
      entry.element.style.zIndex = highlighted ? "5" : "";
    });
  }, [highlightedId, pins]);

  return <div ref={containerRef} className={styles.mapCanvas} />;
}
