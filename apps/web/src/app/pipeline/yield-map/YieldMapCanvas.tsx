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
  /** Solid fill from the median-cap scale; null → hatched submarket-fallback fill. */
  fillColor: string | null;
  /** True when the hood renders on a submarket estimate only. */
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
const HOOD_HATCH_LAYER = "market-hood-hatch";
const HOOD_LINE_LAYER = "market-hood-line";
const HOOD_SOURCE = "market-hoods";
const HATCH_IMAGE = "market-hatch-pattern";

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

/** Diagonal-stripe pattern for hoods running on submarket fallback only. */
function hatchImageData(): ImageData {
  const size = 12;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(100, 116, 139, 0.55)";
  ctx.lineWidth = 2;
  for (let offset = -size; offset <= size * 2; offset += 6) {
    ctx.beginPath();
    ctx.moveTo(offset, -2);
    ctx.lineTo(offset - size, size + 2);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
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
          hatch: hood.fallbackOnly,
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
}

/**
 * MapLibre canvas: neighborhood delineations + metric badges under one marker
 * per geocoded deal (dots) and comp (diamonds), fit to the visible set.
 * Popups open on hover (sticky on click); `highlightedId` enlarges a pin so
 * table-row hover can point at the map. The optional market-context overlay
 * adds median-cap polygon fills with provenance popups plus hollow asking pins.
 */
export function YieldMapCanvas({
  pins,
  boundaries,
  areas,
  showAreas,
  highlightedId,
  onPinHover,
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
  const lastFitKeyRef = useRef<string>("");
  const onPinHoverRef = useRef(onPinHover);
  onPinHoverRef.current = onPinHover;
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
      if (!map.hasImage(HATCH_IMAGE)) {
        map.addImage(HATCH_IMAGE, hatchImageData());
      }
      const data = hoodFeatureCollection(marketHoodsRef.current);
      const source = map.getSource(HOOD_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      map.addSource(HOOD_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: HOOD_FILL_LAYER,
        type: "fill",
        source: HOOD_SOURCE,
        filter: ["!", ["get", "hatch"]],
        paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.38 },
      });
      map.addLayer({
        id: HOOD_HATCH_LAYER,
        type: "fill",
        source: HOOD_SOURCE,
        filter: ["get", "hatch"],
        paint: { "fill-pattern": HATCH_IMAGE, "fill-opacity": 0.85 },
      });
      map.addLayer({
        id: HOOD_LINE_LAYER,
        type: "line",
        source: HOOD_SOURCE,
        paint: { "line-color": "#475569", "line-width": 1, "line-opacity": 0.45 },
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
      for (const layer of [HOOD_FILL_LAYER, HOOD_HATCH_LAYER]) {
        map.on("mousemove", layer, handleMove);
        map.on("mouseleave", layer, handleLeave);
        map.on("click", layer, handleClick);
      }
      map.on("click", (event) => {
        // Clicking outside the polygons unpins the popup.
        const hits = map.queryRenderedFeatures(event.point, { layers: [HOOD_FILL_LAYER, HOOD_HATCH_LAYER] });
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

      // Hover shows the popup; click pins it open until the next map click.
      let sticky = false;
      popup.on("close", () => {
        sticky = false;
        if (openPinPopupRef.current === popup) openPinPopupRef.current = null;
      });
      element.addEventListener("mouseenter", () => {
        onPinHoverRef.current?.(pin.id);
        openExclusive();
      });
      element.addEventListener("mouseleave", () => {
        onPinHoverRef.current?.(null);
        if (!sticky) popup.remove();
      });
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        sticky = !sticky;
        if (sticky) openExclusive();
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
