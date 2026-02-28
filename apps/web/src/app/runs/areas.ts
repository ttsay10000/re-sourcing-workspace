/**
 * NYC area options for Runs filters. Hierarchical: "All X" parents include indented children.
 * Value = API slug (lowercase, spaces to dashes). Sorted alphabetically at each level.
 * When a parent "All X" is selected, children are included and shown greyed out.
 */
export interface AreaNode {
  value: string;
  label: string;
  children?: AreaNode[];
}

/** Sorted alphabetically: top-level, then children at each level. */
export const AREA_TREE: AreaNode[] = [
  {
    value: "all-downtown",
    label: "All Downtown",
    children: [
      { value: "battery-park-city", label: "Battery Park City" },
      { value: "chelsea", label: "Chelsea (includes West Chelsea)" },
      { value: "chinatown", label: "Chinatown" },
      { value: "civic-center", label: "Civic Center" },
      { value: "east-village", label: "East Village" },
      { value: "financial-district", label: "Financial District (includes Fulton/Seaport)" },
      { value: "flatiron", label: "Flatiron (includes Nomad)" },
      { value: "gramercy-park", label: "Gramercy Park" },
      { value: "greenwich-village", label: "Greenwich Village" },
      { value: "little-italy", label: "Little Italy" },
      { value: "lower-east-side", label: "Lower East Side" },
      { value: "nolita", label: "Nolita" },
      { value: "soho", label: "Soho" },
      { value: "stuyvesant-town-pcv", label: "Stuyvesant Town/PCV" },
      { value: "tribeca", label: "Tribeca" },
      { value: "west-village", label: "West Village" },
    ],
  },
  {
    value: "all-midtown",
    label: "All Midtown",
    children: [
      { value: "central-park-south", label: "Central Park South" },
      { value: "hells-kitchen", label: "Hell's Kitchen" },
      { value: "hudson-yards", label: "Hudson Yards" },
      { value: "midtown", label: "Midtown" },
      {
        value: "midtown-east",
        label: "Midtown East",
        children: [
          { value: "kips-bay", label: "Kips Bay" },
          { value: "murray-hill", label: "Murray Hill" },
          { value: "sutton-place", label: "Sutton Place" },
          { value: "turtle-bay", label: "Turtle Bay (includes Beekman)" },
        ],
      },
      { value: "midtown-south", label: "Midtown South" },
    ],
  },
  {
    value: "all-upper-east-side",
    label: "All Upper East Side",
    children: [
      { value: "carnegie-hall", label: "Carnegie Hall" },
      { value: "lenox-hill", label: "Lenox Hill" },
      { value: "upper-carnegie-hill", label: "Upper Carnegie Hill" },
      { value: "yorkville", label: "Yorkville" },
    ],
  },
  {
    value: "all-upper-manhattan",
    label: "All Upper Manhattan",
    children: [
      { value: "central-harlem", label: "Central Harlem" },
      { value: "east-harlem", label: "East Harlem" },
      { value: "fort-george", label: "Fort George" },
      { value: "hamilton-heights", label: "Hamilton Heights" },
      { value: "hudson-heights", label: "Hudson Heights" },
      { value: "inwood", label: "Inwood" },
      { value: "manhattanville", label: "Manhattanville" },
      { value: "marble-hill", label: "Marble Hill" },
      { value: "morningside-heights", label: "Morningside Heights" },
      { value: "south-harlem", label: "South Harlem" },
      { value: "washington-heights", label: "Washington Heights" },
      { value: "west-harlem", label: "West Harlem" },
    ],
  },
  {
    value: "all-upper-west-side",
    label: "All Upper West Side",
    children: [
      { value: "lincoln-square", label: "Lincoln Square" },
      { value: "manhattan-valley", label: "Manhattan Valley" },
    ],
  },
  { value: "roosevelt-island", label: "Roosevelt Island" },
];

/** Map from child value to parent value (for grey-out when parent is selected). */
function buildParentMap(nodes: AreaNode[], parentValue: string | null, out: Map<string, string>) {
  for (const node of nodes) {
    if (parentValue != null) out.set(node.value, parentValue);
    if (node.children?.length) buildParentMap(node.children, node.value, out);
  }
}

export const AREA_PARENT_MAP = (() => {
  const m = new Map<string, string>();
  for (const node of AREA_TREE) {
    if (node.children?.length) buildParentMap(node.children, node.value, m);
  }
  return m;
})();

/** Flattened list for backward compatibility (e.g. default areas string). Same values as tree. */
export function getFlattenedAreaOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  function walk(nodes: AreaNode[]) {
    for (const node of nodes) {
      out.push({ value: node.value, label: node.label });
      if (node.children?.length) walk(node.children);
    }
  }
  walk(AREA_TREE);
  return out;
}

/** Legacy flat list; kept for any code that imports AREA_OPTIONS. */
export const AREA_OPTIONS = getFlattenedAreaOptions();

/** True if this value is included by a selected parent (e.g. "all-downtown" selected => chelsea included). */
export function isIncludedByParent(value: string, selectedAreas: string[]): boolean {
  let v: string | undefined = value;
  while ((v = AREA_PARENT_MAP.get(v)) != null) {
    if (selectedAreas.includes(v)) return true;
  }
  return false;
}
