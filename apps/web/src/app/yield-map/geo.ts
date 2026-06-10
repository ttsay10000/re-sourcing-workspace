/**
 * Minimal planar geometry for the neighborhood overlay: point-in-polygon
 * assignment of deal pins to NTA polygons and label-point placement.
 * Coordinates are GeoJSON [lng, lat] pairs.
 */

type Ring = number[][];

export type NeighborhoodFeature = {
  type: "Feature";
  properties: { code: string; name: string; borough: string; park: boolean };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
};

export type NeighborhoodCollection = {
  type: "FeatureCollection";
  features: NeighborhoodFeature[];
};

function polygonsOf(feature: NeighborhoodFeature): Ring[][] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

/** Ray-casting test against a single ring. */
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export type FeatureBBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export function featureBBox(feature: NeighborhoodFeature): FeatureBBox {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const polygon of polygonsOf(feature)) {
    for (const [lng, lat] of polygon[0]) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** True when the point falls inside the feature (outer ring, outside all holes). */
export function pointInFeature(lng: number, lat: number, feature: NeighborhoodFeature, bbox?: FeatureBBox): boolean {
  if (bbox && (lng < bbox.minLng || lng > bbox.maxLng || lat < bbox.minLat || lat > bbox.maxLat)) return false;
  for (const polygon of polygonsOf(feature)) {
    if (!pointInRing(lng, lat, polygon[0])) continue;
    const inHole = polygon.slice(1).some((hole) => pointInRing(lng, lat, hole));
    if (!inHole) return true;
  }
  return false;
}

/** Signed shoelace area of a ring (degrees² — sign must match the centroid cross terms). */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

/**
 * Label point for a feature: shoelace centroid of the largest outer ring.
 * Good enough for NTA-scale polygons; falls back to the vertex mean when
 * the area degenerates.
 */
export function featureLabelPoint(feature: NeighborhoodFeature): [number, number] {
  let largest: Ring | null = null;
  let largestArea = 0;
  for (const polygon of polygonsOf(feature)) {
    const area = Math.abs(ringArea(polygon[0]));
    if (area > largestArea) {
      largestArea = area;
      largest = polygon[0];
    }
  }
  if (!largest || largest.length === 0) return [0, 0];

  const area = ringArea(largest);
  if (Math.abs(area) < 1e-12) {
    const [sumLng, sumLat] = largest.reduce(([a, b], [lng, lat]) => [a + lng, b + lat], [0, 0]);
    return [sumLng / largest.length, sumLat / largest.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = largest.length - 1; i < largest.length; j = i++) {
    const cross = largest[j][0] * largest[i][1] - largest[i][0] * largest[j][1];
    cx += (largest[j][0] + largest[i][0]) * cross;
    cy += (largest[j][1] + largest[i][1]) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}
