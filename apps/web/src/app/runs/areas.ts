/**
 * NYC + NJ area options for Runs filters. Organized by borough tabs.
 * Hierarchical: "All X" parents auto-select and grey out indented children.
 * Value = API slug (lowercase, spaces to dashes). Multi-borough selection in one run is supported.
 */
export interface AreaNode {
  value: string;
  label: string;
  children?: AreaNode[];
}

/** Borough tab and its area tree. */
export interface BoroughTab {
  id: string;
  label: string;
  tree: AreaNode[];
}

// ----- Manhattan (existing) -----
const MANHATTAN_TREE: AreaNode[] = [
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

// ----- Brooklyn (from screenshot) -----
const BROOKLYN_TREE: AreaNode[] = [
  {
    value: "all-brooklyn",
    label: "All Brooklyn",
    children: [
      { value: "bath-beach", label: "Bath Beach" },
      { value: "bay-ridge", label: "Bay Ridge" },
      { value: "fort-hamilton", label: "Fort Hamilton" },
      { value: "bed-stuy", label: "Bedford-Stuyvesant" },
      { value: "ocean-hill", label: "Ocean Hill" },
      { value: "stuyvesant-heights", label: "Stuyvesant Heights" },
      { value: "bensonhurst", label: "Bensonhurst" },
      { value: "bergen-beach", label: "Bergen Beach" },
      { value: "boerum-hill", label: "Boerum Hill" },
      { value: "borough-park", label: "Borough Park" },
      { value: "mapleton", label: "Mapleton" },
      { value: "brighton-beach", label: "Brighton Beach" },
      { value: "brooklyn-heights", label: "Brooklyn Heights" },
      { value: "brownsville", label: "Brownsville" },
      { value: "bushwick", label: "Bushwick" },
      { value: "canarsie", label: "Canarsie" },
      { value: "carroll-gardens", label: "Carroll Gardens" },
      { value: "clinton-hill", label: "Clinton Hill" },
      { value: "cobble-hill", label: "Cobble Hill" },
      { value: "columbia-st-waterfront", label: "Columbia St Waterfront District" },
      { value: "coney-island", label: "Coney Island" },
      { value: "crown-heights", label: "Crown Heights" },
      { value: "weeksville", label: "Weeksville" },
      { value: "dumbo", label: "DUMBO" },
      { value: "vinegar-hill", label: "Vinegar Hill" },
      { value: "ditmas-park", label: "Ditmas Park" },
      { value: "fiske-terrace", label: "Fiske Terrace" },
      { value: "downtown-brooklyn", label: "Downtown Brooklyn" },
      { value: "dyker-heights", label: "Dyker Heights" },
      { value: "east-flatbush", label: "East Flatbush" },
      { value: "farragut-wingate", label: "Farragut, Wingate" },
      { value: "east-new-york", label: "East New York" },
      { value: "city-line", label: "City Line" },
      { value: "cypress-hills", label: "Cypress Hills" },
      { value: "new-lots-starrett", label: "New Lots, Starrett City" },
      { value: "flatbush", label: "Flatbush" },
      { value: "flatlands", label: "Flatlands" },
      { value: "fort-greene", label: "Fort Greene" },
      { value: "gerritsen-beach", label: "Gerritsen Beach" },
      { value: "gowanus", label: "Gowanus" },
      { value: "gravesend", label: "Gravesend" },
      { value: "greenpoint", label: "Greenpoint" },
      { value: "greenwood", label: "Greenwood" },
      { value: "kensington", label: "Kensington" },
      { value: "manhattan-beach", label: "Manhattan Beach" },
      { value: "marine-park", label: "Marine Park" },
      { value: "midwood", label: "Midwood" },
      { value: "mill-basin", label: "Mill Basin" },
      { value: "ocean-parkway", label: "Ocean Parkway" },
      { value: "old-mill-basin", label: "Old Mill Basin" },
      { value: "park-slope", label: "Park Slope" },
      { value: "prospect-heights", label: "Prospect Heights" },
      { value: "prospect-lefferts-gardens", label: "Prospect Lefferts Gardens" },
      { value: "prospect-park-south", label: "Prospect Park South" },
      { value: "red-hook", label: "Red Hook" },
      { value: "seagate", label: "Seagate" },
      { value: "sheepshead-bay", label: "Sheepshead Bay" },
      { value: "homecrest-madison", label: "Homecrest, Madison" },
      { value: "sunset-park", label: "Sunset Park" },
      { value: "williamsburg", label: "Williamsburg" },
      { value: "east-williamsburg", label: "East Williamsburg" },
      { value: "windsor-terrace", label: "Windsor Terrace" },
    ],
  },
];

// ----- Queens (from screenshots 3–4; Rockaway has sub-areas) -----
const QUEENS_TREE: AreaNode[] = [
  {
    value: "all-queens",
    label: "All Queens",
    children: [
      { value: "astoria", label: "Astoria" },
      { value: "ditmars-steinway", label: "Ditmars-Steinway" },
      { value: "auburndale", label: "Auburndale" },
      { value: "bayside", label: "Bayside" },
      { value: "bay-terrace-queens", label: "Bay Terrace (Queens)" },
      { value: "bellerose", label: "Bellerose" },
      { value: "briarwood", label: "Briarwood" },
      { value: "brookville", label: "Brookville" },
      { value: "cambria-heights", label: "Cambria Heights" },
      { value: "clearview", label: "Clearview" },
      { value: "college-point", label: "College Point" },
      { value: "corona", label: "Corona" },
      { value: "douglaston", label: "Douglaston" },
      { value: "east-elmhurst", label: "East Elmhurst" },
      { value: "elmhurst", label: "Elmhurst" },
      { value: "floral-park", label: "Floral Park" },
      { value: "flushing", label: "Flushing" },
      { value: "east-flushing-murray-hill", label: "East Flushing, Murray Hill (Queens)" },
      { value: "forest-hills", label: "Forest Hills" },
      { value: "fresh-meadows", label: "Fresh Meadows" },
      { value: "glen-oaks", label: "Glen Oaks" },
      { value: "glendale", label: "Glendale" },
      { value: "hillcrest", label: "Hillcrest" },
      { value: "hollis", label: "Hollis" },
      { value: "howard-beach", label: "Howard Beach" },
      { value: "hamilton-beach-lindenwood", label: "Hamilton Beach, Lindenwood, Old Howard Beach, Ramblersville, Rockwood Park" },
      { value: "jackson-heights", label: "Jackson Heights" },
      { value: "jamaica", label: "Jamaica" },
      { value: "jamaica-estates", label: "Jamaica Estates" },
      { value: "jamaica-hills", label: "Jamaica Hills" },
      { value: "kew-gardens", label: "Kew Gardens" },
      { value: "kew-gardens-hills", label: "Kew Gardens Hills" },
      { value: "laurelton", label: "Laurelton" },
      { value: "little-neck", label: "Little Neck" },
      { value: "long-island-city", label: "Long Island City" },
      { value: "hunters-point", label: "Hunters Point" },
      { value: "maspeth", label: "Maspeth" },
      { value: "middle-village", label: "Middle Village" },
      { value: "new-hyde-park", label: "New Hyde Park" },
      { value: "north-corona", label: "North Corona" },
      { value: "oakland-gardens", label: "Oakland Gardens" },
      { value: "ozone-park", label: "Ozone Park" },
      { value: "pomonok", label: "Pomonok" },
      { value: "queens-village", label: "Queens Village" },
      { value: "rego-park", label: "Rego Park" },
      { value: "richmond-hill", label: "Richmond Hill" },
      { value: "ridgewood", label: "Ridgewood" },
      {
        value: "rockaway-all",
        label: "Rockaway (All)",
        children: [
          { value: "arverne", label: "Arverne" },
          { value: "bayswater", label: "Bayswater" },
          { value: "belle-harbor", label: "Belle Harbor" },
          { value: "breezy-point", label: "Breezy Point" },
          { value: "broad-channel", label: "Broad Channel" },
          { value: "edgemere", label: "Edgemere" },
          { value: "far-rockaway", label: "Far Rockaway" },
          { value: "hammels-neponsit", label: "Hammels, Neponsit" },
          { value: "rockaway-park", label: "Rockaway Park" },
          { value: "rosedale", label: "Rosedale" },
        ],
      },
      { value: "south-jamaica", label: "South Jamaica" },
      { value: "south-ozone-park", label: "South Ozone Park" },
      { value: "south-richmond-hill", label: "South Richmond Hill" },
      { value: "springfield-gardens", label: "Springfield Gardens" },
      { value: "st-albans", label: "St. Albans" },
      { value: "sunnyside", label: "Sunnyside" },
      { value: "utopia", label: "Utopia" },
      { value: "whitestone", label: "Whitestone" },
      { value: "beechhurst-malba", label: "Beechhurst, Malba" },
      { value: "woodhaven", label: "Woodhaven" },
      { value: "woodside", label: "Woodside" },
    ],
  },
];

// ----- New Jersey (from screenshot 5; Jersey City has sub-areas) -----
const NEW_JERSEY_TREE: AreaNode[] = [
  {
    value: "all-new-jersey",
    label: "All New Jersey",
    children: [
      { value: "bayonne", label: "Bayonne" },
      { value: "cliffside-park", label: "Cliffside Park" },
      { value: "east-newark", label: "East Newark" },
      { value: "edgewater", label: "Edgewater" },
      { value: "fort-lee", label: "Fort Lee" },
      { value: "guttenberg", label: "Guttenberg" },
      { value: "harrison", label: "Harrison" },
      {
        value: "jersey-city",
        label: "Jersey City",
        children: [
          { value: "jersey-city-bergen-lafayette", label: "Bergen/Lafayette" },
          { value: "jersey-city-historic-downtown", label: "Historic Downtown" },
          { value: "jersey-city-journal-square", label: "Journal Square" },
          { value: "jersey-city-mcginley-square", label: "McGinley Square" },
          { value: "jersey-city-newport", label: "Newport" },
          { value: "jersey-city-the-heights", label: "The Heights" },
          { value: "jersey-city-waterfront", label: "Waterfront" },
          { value: "jersey-city-paulus-hook", label: "Paulus Hook" },
          { value: "jersey-city-west-side", label: "West Side" },
        ],
      },
      { value: "kearny", label: "Kearny" },
      { value: "north-bergen", label: "North Bergen" },
      { value: "secaucus", label: "Secaucus" },
      { value: "union-city", label: "Union City" },
      { value: "weehawken", label: "Weehawken" },
      { value: "west-new-york", label: "West New York" },
    ],
  },
];

// ----- Bronx (placeholder; add neighborhoods as needed) -----
const BRONX_TREE: AreaNode[] = [
  { value: "all-bronx", label: "All Bronx", children: [] },
];

// ----- Staten Island (placeholder) -----
const STATEN_ISLAND_TREE: AreaNode[] = [
  { value: "all-staten-island", label: "All Staten Island", children: [] },
];

/** Borough tabs in display order. Select from multiple boroughs in one run. */
export const BOROUGH_TABS: BoroughTab[] = [
  { id: "MANHATTAN", label: "MANHATTAN", tree: MANHATTAN_TREE },
  { id: "BRONX", label: "BRONX", tree: BRONX_TREE },
  { id: "BROOKLYN", label: "BROOKLYN", tree: BROOKLYN_TREE },
  { id: "QUEENS", label: "QUEENS", tree: QUEENS_TREE },
  { id: "STATEN_ISLAND", label: "STATEN ISLAND", tree: STATEN_ISLAND_TREE },
  { id: "NEW_JERSEY", label: "NEW JERSEY", tree: NEW_JERSEY_TREE },
];

/** Flat AREA_TREE for backward compat (Manhattan only). Prefer BOROUGH_TABS. */
export const AREA_TREE: AreaNode[] = MANHATTAN_TREE;

/** Map from child value to parent value (for grey-out when parent is selected). Built from all boroughs. */
function buildParentMap(nodes: AreaNode[], parentValue: string | null, out: Map<string, string>) {
  for (const node of nodes) {
    if (parentValue != null) out.set(node.value, parentValue);
    if (node.children?.length) buildParentMap(node.children, node.value, out);
  }
}

export const AREA_PARENT_MAP = (() => {
  const m = new Map<string, string>();
  for (const tab of BOROUGH_TABS) {
    for (const node of tab.tree) {
      if (node.children?.length) buildParentMap(node.children, node.value, m);
    }
  }
  return m;
})();

function flattenNodes(nodes: AreaNode[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  function walk(n: AreaNode[]) {
    for (const node of n) {
      out.push({ value: node.value, label: node.label });
      if (node.children?.length) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

/** Flattened list of all area values across all boroughs (for API areas string). */
export function getFlattenedAreaOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const tab of BOROUGH_TABS) {
    out.push(...flattenNodes(tab.tree));
  }
  return out;
}

/** Legacy flat list (all boroughs). */
export const AREA_OPTIONS = getFlattenedAreaOptions();

/** True if this value is included by a selected parent (e.g. "all-downtown" selected => chelsea included). */
export function isIncludedByParent(value: string, selectedAreas: string[]): boolean {
  let v: string | undefined = value;
  while ((v = AREA_PARENT_MAP.get(v)) != null) {
    if (selectedAreas.includes(v)) return true;
  }
  return false;
}
