// Shared projection + tiling constants (used by both the Node pipeline and the runtime).
export const LAT0 = 40.7831; // city anchor (mid-Manhattan) — keeps local distortion tiny
export const LON0 = -73.9712;
export const M_PER_DEG_LAT = 111132.0;
export const M_PER_DEG_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180); // ~84,300

export const TILE = 512;    // near tile size, meters
export const MACRO = 2048;  // far LoD macro tile size, meters
export const FT = 0.3048;   // feet → meters

// world: x = east, z = south (north is -z), y = up (meters above sea level)
export function project(lon, lat) {
  return [ (lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT ];
}
export function unproject(x, z) {
  return [ x / M_PER_DEG_LON + LON0, -z / M_PER_DEG_LAT + LAT0 ];
}
export const tileId = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
export const macroId = (x, z) => `${Math.floor(x / MACRO)}_${Math.floor(z / MACRO)}`;

// Furniture kind ids (compiler writes, runtime instancing reads)
export const FURN = {
  TREE: 1, LAMP_COBRA: 2, LAMP_CROOK: 3, HYDRANT: 4, SIGNAL_MAST: 5, SIGNAL_PED: 6,
  STREET_SIGN: 7, LITTER: 8, MAILBOX: 9, BUS_SHELTER: 10, SUBWAY_ENTRANCE: 11,
  LINKNYC: 12, NEWSSTAND: 13, SCAFFOLD: 14, BENCH: 15, AWNING: 16, BIKE_RACK: 17,
  PHONE: 18, PLANTER: 19, STOOP: 20, FIRE_ESCAPE: 21, WATER_TOWER: 22, ROOF_AC: 23,
  ROOF_BULKHEAD: 24, CHIMNEY_POT: 25, STANDPIPE: 26, CONE: 27, FLAG: 28, MARQUEE: 29,
  CHURCH_TOWER: 30, CROSSING_BEACON: 31, PARKING_METER: 32,
};

// Building facade style ids (shader switches behavior on these)
export const STYLE = {
  TENEMENT: 0,       // punched windows, brick, fire escapes
  PREWAR_APT: 1,     // punched windows, masonry base, cornice
  POSTWAR_BRICK: 2,  // white/tan brick, strip windows, balconies
  MODERN_GLASS: 3,   // curtain wall mullion grid
  DECO_MASONRY: 4,   // vertical piers, setback tower era
  ROWHOUSE: 5,       // brownstone/townhouse, stoop, tall parlor windows
  LOFT_CASTIRON: 6,  // very large windows, columned bays
  INDUSTRIAL: 7,     // big steel sash grids, brick
  CIVIC_STONE: 8,    // limestone, tall floors, few big windows
  CHURCH: 9,         // stone, arched windows (mostly custom massing)
  RETAIL_STRIP: 10,  // 1-2 floors, all storefront
  GLASS_TOWER_BLUE: 11, // post-2000 blue/green glass supertall
  PROJECT_BRICK: 12, // NYCHA towers: red-brown brick, regular small windows
  // ROUND 9 (docs/notes/roofs-r9.md): post-1995 big-box / mall-format retail —
  // glazed base with a signage band, blank metal/fibre-cement panel facade
  // above, roof parapet. NOTE FOR WHOEVER ADDS THE NEXT ID: materials.js keys
  // its facade families on open-ended style RANGES and `style > 11.5` means
  // PROJECT_BRICK red brick in three places, so ids above 12 inherit NYCHA
  // brick wherever they reach the WINDOWED branch. RETAIL_MODERN avoids that
  // by rendering its upper facade through the (style-independent) blind branch
  // — see assemble.js `retailModern()`.
  RETAIL_MODERN: 13,
  // WB13 (docs/notes/wburg-r13.md): the outer-borough frame belt. North
  // Williamsburg / Greenpoint / Bushwick / Ridgewood / Astoria is 42 % class-C
  // walk-ups and 8 % A/B houses of 1880-1920, wood-frame or brick RE-CLAD in
  // vinyl or aluminium siding, flat roof behind a boxed cornice, low stoop, no
  // fire escape. Rendering them as Harlem red-brick TENEMENT is why the twin
  // and the Bedford Ave reference look like different cities.
  // Companion: the post-2000 4-9 floor condo (class R/RM/D) that replaced the
  // lots between them — big windows, balcony slabs, panel-and-brick, roof deck.
  //
  // NOTE FOR WHOEVER ADDS THE NEXT ID (id 16), updated from the round-9 note.
  // materials.js keys its facade families on open-ended style RANGES. The four
  // that used to read `style > 11.5` (NYCHA red brick / brickish / residential
  // windows) are now CLOSED at `< 13.5`, so a new id no longer silently
  // inherits NYCHA brick — but it also means a new id reaches NO wall family
  // and renders as flat tint. The keys an id above 13 must touch, in order:
  //   materials.js  L~1382 `resi`, L~1894 wall-tile family, L~1942 `wStone`,
  //                 L~1954 `brickish`, L~2124 `resiW`, L~2244 `stoneD`
  //                 (+ its own branch, if it is not masonry)
  //   assemble.js   fac8Palette() hue-family gate, fac8Year(), fac8Membrane()
  //   roofEngine.js pickArchetype() — falls through to 'tenement' otherwise
  //   nycDress.js   RECIPES (absent = dresser skips the style, which is free)
  //   heroFacades.js _build() — the projecting stone sill is UNCONDITIONAL
  FRAME_HOUSE: 14,   // WB13 vinyl / aluminium lap siding, flat roof, boxed cornice
  CONDO_NEW: 15,     // WB13 post-2000 small condo: big glazing, balconies, panels
};

// flags bitfield on building records
export const BF = {
  WATERTOWER: 1, CORNICE: 2, FIRE_ESCAPE: 4, STOREFRONT: 8, SETBACKS: 16,
  LANDMARK: 32, STOOP: 64, GABLE: 128, // STOOP reuses the never-read BLINDS_COMPUTED bit: the compiler emitted a stoop for this building (door sits at the landing, 1.70 m)
};
