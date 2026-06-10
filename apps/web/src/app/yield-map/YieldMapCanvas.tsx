"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./yieldMap.module.css";

export type MapPin = {
  propertyId: string;
  address: string;
  lat: number;
  lng: number;
  color: string;
  /** Stat lines shown in the popup under the address. */
  lines: string[];
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

const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const MANHATTAN_CENTER: [number, number] = [-73.978, 40.752];

const HOOD_FILL_LAYER = "market-hood-fill";
const HOOD_HATCH_LAYER = "market-hood-hatch";
const HOOD_LINE_LAYER = "market-hood-line";
const HOOD_SOURCE = "market-hoods";
const HATCH_IMAGE = "market-hatch-pattern";

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

export interface YieldMapCanvasProps {
  pins: MapPin[];
  /** Market-context overlay; omit to render the classic deal-pin map only. */
  marketHoods?: MarketHood[];
  hollowPins?: HollowPin[];
  /** Builds the hover/click popup content for one neighborhood. */
  renderHoodPopup?: (hoodId: string) => HTMLElement | null;
}

/** MapLibre canvas: deal markers + the market-context polygon layer. */
export function YieldMapCanvas({ pins, marketHoods, hollowPins, renderHoodPopup }: YieldMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hollowMarkersRef = useRef<maplibregl.Marker[]>([]);
  const hoodPopupRef = useRef<maplibregl.Popup | null>(null);
  const hoodPopupPinnedRef = useRef(false);
  const hoveredHoodRef = useRef<string | null>(null);
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
    mapRef.current = map;
    // Debug/e2e handle (used by screenshot tooling; harmless in production).
    (window as Window & { __yieldMap?: maplibregl.Map }).__yieldMap = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      hollowMarkersRef.current.forEach((marker) => marker.remove());
      hollowMarkersRef.current = [];
      hoodPopupRef.current?.remove();
      hoodPopupRef.current = null;
      map.remove();
      mapRef.current = null;
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

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [marketHoods]);

  // Deal pins (existing layer — untouched behavior).
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
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "280px" }).setDOMContent(hollowPopupNode(pin));
      return new maplibregl.Marker({ element }).setLngLat([pin.lng, pin.lat]).setPopup(popup).addTo(map);
    });
  }, [hollowPins]);

  return <div ref={containerRef} className={styles.mapCanvas} />;
}
