"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./rentalAnalysis.module.css";

export interface RentalMapPin {
  id: string;
  source: "haus" | "rove" | "blueground";
  lat: number;
  lng: number;
  color: string;
  excluded: boolean;
  highlighted: boolean;
  /** Popup body. */
  title: string;
  subtitle: string;
  lines: string[];
  imageUrl?: string | null;
  url?: string | null;
}

export interface RentalMapTarget {
  lat: number;
  lng: number;
  label: string;
  radiusMiles?: number | null;
}

const NYC_CENTER: [number, number] = [-73.97, 40.75];

const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

/** ~miles → degrees latitude (for the comp-radius circle). */
function milesToLatDegrees(miles: number): number {
  return miles / 69;
}

function circleGeoJson(lng: number, lat: number, radiusMiles: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const points = 64;
  const latRadius = milesToLatDegrees(radiusMiles);
  const lngRadius = latRadius / Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    ring.push([lng + lngRadius * Math.cos(theta), lat + latRadius * Math.sin(theta)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

export function RentalMapCanvas({
  pins,
  target,
}: {
  pins: RentalMapPin[];
  target: RentalMapTarget | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE,
      center: NYC_CENTER,
      zoom: 11.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      loadedRef.current = true;
      map.addSource("target-radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "target-radius-fill",
        type: "fill",
        source: "target-radius",
        paint: { "fill-color": "#0f766e", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: "target-radius-line",
        type: "line",
        source: "target-radius",
        paint: { "line-color": "#0f766e", "line-opacity": 0.45, "line-width": 1.4, "line-dasharray": [3, 2] },
      });
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Pins + target marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    for (const pin of pins) {
      const el = document.createElement("div");
      el.className = [
        styles.mapPin,
        pin.source === "rove" ? styles.mapPinSquare : pin.source === "blueground" ? styles.mapPinDiamond : "",
        pin.excluded ? styles.mapPinExcluded : "",
        pin.highlighted ? styles.mapPinHighlighted : "",
      ]
        .filter(Boolean)
        .join(" ");
      el.style.background = pin.color;

      el.addEventListener("click", (event) => {
        event.stopPropagation();
        popupRef.current?.remove();
        const html = `
          <div class="${styles.popup}">
            ${pin.imageUrl ? `<img src="${pin.imageUrl}" alt="" class="${styles.popupImage}" />` : ""}
            <div class="${styles.popupTitle}">${pin.title}</div>
            <div class="${styles.popupSubtitle}">${pin.subtitle}</div>
            ${pin.lines.map((line) => `<div class="${styles.popupLine}">${line}</div>`).join("")}
            ${pin.url ? `<a href="${pin.url}" target="_blank" rel="noopener noreferrer" class="${styles.popupLink}">View listing ↗</a>` : ""}
          </div>`;
        popupRef.current = new maplibregl.Popup({ offset: 14, maxWidth: "280px" })
          .setLngLat([pin.lng, pin.lat])
          .setHTML(html)
          .addTo(map);
      });

      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map));
    }

    if (target) {
      const el = document.createElement("div");
      el.className = styles.mapTarget;
      el.title = target.label;
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([target.lng, target.lat]).addTo(map));
    }
  }, [pins, target]);

  // Target radius + recenter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("target-radius") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      if (target && target.radiusMiles) {
        source.setData({
          type: "FeatureCollection",
          features: [circleGeoJson(target.lng, target.lat, target.radiusMiles)],
        });
      } else {
        source.setData({ type: "FeatureCollection", features: [] });
      }
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
    if (target) {
      map.flyTo({ center: [target.lng, target.lat], zoom: 13.2, duration: 700 });
    }
  }, [target]);

  return <div ref={containerRef} className={styles.mapCanvas} />;
}
