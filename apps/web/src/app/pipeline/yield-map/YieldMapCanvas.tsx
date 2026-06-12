"use client";

import { useCallback, useEffect, useRef } from "react";
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
  /** Neighborhood (· borough) tag rendered directly under the address. */
  neighborhood?: string | null;
  /** Dashed ring: numbers come from an OM extraction still awaiting review. */
  pending?: boolean;
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

/** Market-comp record rendered as a hollow pin (asking prices: never in fills/medians). */
export type HollowPin = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  color: string;
  lines: string[];
};

/** One neighborhood polygon of the market-context overlay. */
export type MarketHood = {
  id: string;
  name: string;
  polygon: [number, number][];
  /** Soft tint from the median-cap scale; null → faint neutral fill. */
  fillColor: string | null;
  /** True when the hood renders on a submarket estimate only (fainter fill). */
  fallbackOnly: boolean;
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

const HOOD_FILL_LAYER = "market-hood-fill";
const HOOD_SOURCE = "market-hoods";

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

  if (pin.neighborhood) {
    const hood = document.createElement("span");
    hood.className = styles.popupHood;
    hood.textContent = pin.neighborhood;
    root.appendChild(hood);
  }

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

function hollowPopupNode(pin: HollowPin): HTMLElement {
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
  return root;
}

function hoodFeatureCollection(hoods: MarketHood[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: hoods.map((hood) => {
      const ring = [...hood.polygon];
      if (ring.length > 0) ring.push(ring[0]);
      return {
        type: "Feature",
        id: hood.id,
        properties: {
          hoodId: hood.id,
          name: hood.name,
          fillColor: hood.fillColor ?? "#94a3b8",
          fallback: hood.fallbackOnly,
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    }),
  };
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
  /** Cancels a pending hover-intent popup so teardown can't resurrect it. */
  cancelHover: () => void;
}

/**
 * MapLibre canvas: neighborhood delineations + metric badges under one marker
 * per geocoded deal (dots) and comp (diamonds), fit to the visible set.
 * Hover shows a popup after a short intent delay (so sweeping across the
 * comps layer doesn't flicker); clicking a pin SELECTS it (`onPinSelect`
 * opens the property wizard). `highlightedId` enlarges a pin so table-row
 * hover can point at the map. The optional market-context overlay adds
 * median-cap polygon fills with provenance popups plus hollow asking pins.
 */
const PIN_HOVER_INTENT_MS = 150;

export function YieldMapCanvas({
  pins,
  boundaries,
  areas,
  showAreas,
  highlightedId,
  onPinHover,
  onPinSelect,
  marketHoods,
  hollowPins,
  renderHoodPopup,
}: {
  pins: MapPin[];
  boundaries: NeighborhoodCollection | null;
  areas: AreaStat[];
  showAreas: boolean;
  highlightedId?: string | null;
  onPinHover?: (id: string | null) => void;
  /** Click = select: open the property wizard for this pin's deal. */
  onPinSelect?: (propertyId: string) => void;
  /** Market-context overlay; omit to render the deal-pin map only. */
  marketHoods?: MarketHood[];
  hollowPins?: HollowPin[];
  /** Builds the hover/click popup content for one neighborhood. */
  renderHoodPopup?: (hoodId: string) => HTMLElement | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const badgesRef = useRef<maplibregl.Marker[]>([]);
  const hollowMarkersRef = useRef<maplibregl.Marker[]>([]);
  const hoodPopupRef = useRef<maplibregl.Popup | null>(null);
  const hoodPopupPinnedRef = useRef(false);
  const hoveredHoodRef = useRef<string | null>(null);
  // One pin popup at a time: the screenshot failure mode was several hover
  // popups + neighborhood cards stacking into an unreadable pile.
  const openPinPopupRef = useRef<maplibregl.Popup | null>(null);
  const styleReadyRef = useRef(false);
  // The camera auto-fits exactly once (first non-empty pin set). Filtering,
  // searching, toggles, and the 60s auto-refresh must never move a map the
  // user is looking at — the Recenter button refits on demand.
  const hasAutoFitRef = useRef(false);
  const lastPinsKeyRef = useRef<string>("");
  const pinsRef = useRef<MapPin[]>([]);
  pinsRef.current = pins;
  const onPinHoverRef = useRef(onPinHover);
  onPinHoverRef.current = onPinHover;
  const onPinSelectRef = useRef(onPinSelect);
  onPinSelectRef.current = onPinSelect;
  const renderHoodPopupRef = useRef<typeof renderHoodPopup>(renderHoodPopup);
  renderHoodPopupRef.current = renderHoodPopup;
  // Latest hoods read inside deferred "load" callbacks so a stale empty
  // closure can never overwrite data that arrived while the style loaded.
  const marketHoodsRef = useRef<MarketHood[]>([]);
  marketHoodsRef.current = marketHoods ?? [];

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
    // Debug/e2e handle (used by screenshot tooling; harmless in production).
    (window as Window & { __yieldMap?: maplibregl.Map }).__yieldMap = map;
    return () => {
      markersRef.current.forEach((entry) => {
        entry.cancelHover();
        entry.popup.remove();
        entry.marker.remove();
      });
      markersRef.current.clear();
      badgesRef.current.forEach((marker) => marker.remove());
      badgesRef.current = [];
      hollowMarkersRef.current.forEach((marker) => marker.remove());
      hollowMarkersRef.current = [];
      hoodPopupRef.current?.remove();
      hoodPopupRef.current = null;
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // Market-context polygon layer (fill scale + hatched fallback + hover popups).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const data = hoodFeatureCollection(marketHoodsRef.current);
      const source = map.getSource(HOOD_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      map.addSource(HOOD_SOURCE, { type: "geojson", data });
      // One soft tint per hood — no outlines or hatching, so the market layer
      // shades the basemap the way the original neighborhood fills did and
      // pins/badges keep the visual hierarchy. Submarket-fallback hoods get a
      // fainter wash; the popup explains their provenance.
      map.addLayer({
        id: HOOD_FILL_LAYER,
        type: "fill",
        source: HOOD_SOURCE,
        paint: {
          "fill-color": ["get", "fillColor"],
          "fill-opacity": ["case", ["get", "fallback"], 0.08, 0.16],
        },
      });

      const showPopup = (hoodId: string, lngLat: maplibregl.LngLatLike) => {
        const content = renderHoodPopupRef.current?.(hoodId);
        if (!content) return;
        if (!hoodPopupRef.current) {
          hoodPopupRef.current = new maplibregl.Popup({
            offset: 10,
            closeButton: false,
            // Pin/unpin is managed by the outside-click handler below; the
            // default closeOnClick would dismiss the popup on the same click
            // that pins it.
            closeOnClick: false,
            maxWidth: "360px",
            className: styles.hoodPopupShell,
          });
        }
        hoodPopupRef.current.setLngLat(lngLat).setDOMContent(content).addTo(map);
      };

      const handleMove = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const hoodId = feature?.properties?.hoodId as string | undefined;
        if (!hoodId) return;
        map.getCanvas().style.cursor = "pointer";
        if (hoodPopupPinnedRef.current) return;
        if (hoveredHoodRef.current !== hoodId) {
          hoveredHoodRef.current = hoodId;
          showPopup(hoodId, event.lngLat);
        } else {
          hoodPopupRef.current?.setLngLat(event.lngLat);
        }
      };
      const handleLeave = () => {
        map.getCanvas().style.cursor = "";
        hoveredHoodRef.current = null;
        if (!hoodPopupPinnedRef.current) hoodPopupRef.current?.remove();
      };
      const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
        const hoodId = event.features?.[0]?.properties?.hoodId as string | undefined;
        if (!hoodId) return;
        hoodPopupPinnedRef.current = true;
        showPopup(hoodId, event.lngLat);
      };
      map.on("mousemove", HOOD_FILL_LAYER, handleMove);
      map.on("mouseleave", HOOD_FILL_LAYER, handleLeave);
      map.on("click", HOOD_FILL_LAYER, handleClick);
      map.on("click", (event) => {
        // Clicking outside the polygons unpins the popup.
        const hits = map.queryRenderedFeatures(event.point, { layers: [HOOD_FILL_LAYER] });
        if (hits.length === 0) {
          hoodPopupPinnedRef.current = false;
          hoodPopupRef.current?.remove();
        }
      });
    };

    if (styleReadyRef.current) apply();
    else map.once("load", apply);
  }, [marketHoods]);

  // Hollow pins: asking-price market records, visually distinct from deal pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    hollowMarkersRef.current.forEach((marker) => marker.remove());
    hollowMarkersRef.current = (hollowPins ?? []).map((pin) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = styles.hollowPin;
      element.style.borderColor = pin.color;
      element.setAttribute("aria-label", `${pin.address} (asking)`);
      const popup = new maplibregl.Popup({
        offset: 12,
        closeButton: false,
        maxWidth: "280px",
        className: styles.pinPopupShell,
      }).setDOMContent(hollowPopupNode(pin));
      return new maplibregl.Marker({ element }).setLngLat([pin.lng, pin.lat]).setPopup(popup).addTo(map);
    });
  }, [hollowPins]);

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

  const fitToPins = useCallback((duration = 350) => {
    const map = mapRef.current;
    const currentPins = pinsRef.current;
    if (!map || currentPins.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    currentPins.forEach((pin) => bounds.extend([pin.lng, pin.lat]));
    map.fitBounds(bounds, { padding: 56, maxZoom: 14.5, duration });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Identical content (the 60s auto-refresh usually returns the same set)
    // leaves the existing markers alone instead of tearing down popups and
    // hover state mid-interaction.
    const pinsKey = pins
      .map((pin) =>
        [pin.id, pin.lat, pin.lng, pin.color, pin.kind, pin.pending ? 1 : 0, pin.address, pin.neighborhood ?? "", pin.lines.join("~")].join("|")
      )
      .join("\n");
    if (pinsKey === lastPinsKeyRef.current) return;
    lastPinsKeyRef.current = pinsKey;

    markersRef.current.forEach((entry) => {
      entry.cancelHover();
      entry.popup.remove();
      entry.marker.remove();
    });
    markersRef.current.clear();

    for (const pin of pins) {
      const element = document.createElement("button");
      element.type = "button";
      const classes = [styles.pin];
      if (pin.kind === "comp") classes.push(styles.pinComp);
      if (pin.pending) classes.push(styles.pinPending);
      element.className = classes.join(" ");
      element.style.background = pin.color;
      element.setAttribute("aria-label", pin.kind === "comp" ? `Comp: ${pin.address}` : pin.address);

      const popup = new maplibregl.Popup({
        offset: 12,
        closeButton: false,
        maxWidth: "300px",
        // The info card always floats above pins, badges, and hood cards —
        // the dots stay visible underneath.
        className: styles.pinPopupShell,
      })
        .setDOMContent(popupNode(pin))
        .setLngLat([pin.lng, pin.lat]);

      const openExclusive = () => {
        if (openPinPopupRef.current && openPinPopupRef.current !== popup) openPinPopupRef.current.remove();
        if (!hoodPopupPinnedRef.current) hoodPopupRef.current?.remove();
        if (!popup.isOpen()) popup.addTo(map);
        openPinPopupRef.current = popup;
      };

      // Hover highlights and (after a short intent delay) shows the popup —
      // never more. Click is the select action: it opens the property wizard
      // via onPinSelect and keeps the popup pinned until the next map click.
      let sticky = false;
      let hoverTimer: number | null = null;
      const clearHoverTimer = () => {
        if (hoverTimer != null) {
          window.clearTimeout(hoverTimer);
          hoverTimer = null;
        }
      };
      popup.on("close", () => {
        sticky = false;
        if (openPinPopupRef.current === popup) openPinPopupRef.current = null;
      });
      element.addEventListener("mouseenter", () => {
        onPinHoverRef.current?.(pin.id);
        clearHoverTimer();
        hoverTimer = window.setTimeout(() => {
          hoverTimer = null;
          openExclusive();
        }, PIN_HOVER_INTENT_MS);
      });
      element.addEventListener("mouseleave", () => {
        onPinHoverRef.current?.(null);
        clearHoverTimer();
        if (!sticky) popup.remove();
      });
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        clearHoverTimer();
        sticky = true;
        openExclusive();
        onPinSelectRef.current?.(pin.propertyId);
      });

      const marker = new maplibregl.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map);
      markersRef.current.set(pin.id, { marker, element, popup, cancelHover: clearHoverTimer });
    }

    // Auto-fit exactly once, when pins first arrive; afterwards the camera
    // belongs to the user (Recenter refits on demand).
    if (pins.length > 0 && !hasAutoFitRef.current) {
      hasAutoFitRef.current = true;
      fitToPins(0);
    }
  }, [pins, fitToPins]);

  // Table-row hover → enlarge + ring the matching pin.
  useEffect(() => {
    markersRef.current.forEach((entry, id) => {
      const highlighted = id === highlightedId;
      entry.element.classList.toggle(styles.pinHighlighted, highlighted);
      entry.element.style.zIndex = highlighted ? "5" : "";
    });
  }, [highlightedId, pins]);

  return (
    <div className={styles.mapCanvasWrap}>
      <div ref={containerRef} className={styles.mapCanvas} />
      <button
        type="button"
        className={styles.mapRecenter}
        onClick={() => fitToPins()}
        title="Fit the map to the visible pins"
      >
        ⌖ Recenter
      </button>
    </div>
  );
}
