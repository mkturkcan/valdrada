import { TW_TOWERS } from '../city/tk/tkOverrides.js';   // TW: the towers lane's facts per tower (colour, style)
// Landmark registry — compiler marks the building footprint containing (lat,lon)
// with the landmark id; the runtime swaps in / decorates with a custom builder.
// mode: 'replace' = custom massing replaces the extrusion
//       'decorate' = data extrusion kept, builder adds signature elements (spire, crown...)
export const LANDMARKS = [
  // ---- Morningside Heights & Harlem (priority) ----
  { id: 1,  key: 'lowLibrary',      name: 'Low Memorial Library',        lat: 40.80800, lon: -73.96188, mode: 'replace' },
  { id: 2,  key: 'butlerLibrary',   name: 'Butler Library',              lat: 40.80642, lon: -73.96319, mode: 'replace' },
  // CR24: was lon -73.96035, 55 m east of the chapel, inside Fayerweather Hall's footprint (the chapel replaced Fayerweather
  // and the real chapel drew as a generic hall); this point is the chapel's own crossing (the reference north view)
  { id: 3,  key: 'stPaulsChapel',   name: "St. Paul's Chapel (Columbia)",lat: 40.807854, lon: -73.960942, mode: 'replace' },
  { id: 4,  key: 'riversideChurch', name: 'Riverside Church',            lat: 40.81110, lon: -73.96420, mode: 'replace' },
  { id: 5,  key: 'grantsTomb',      name: "General Grant National Memorial", lat: 40.81340, lon: -73.96320, mode: 'replace' },
  { id: 6,  key: 'stJohnDivine',    name: 'Cathedral of St. John the Divine', lat: 40.80390, lon: -73.96180, mode: 'replace' },
  { id: 7,  key: 'shepardHall',     name: 'Shepard Hall (City College)', lat: 40.81985, lon: -73.94935, mode: 'replace' },
  { id: 8,  key: 'apolloTheater',   name: 'Apollo Theater',              lat: 40.81007, lon: -73.95003, mode: 'decorate' },
  { id: 9,  key: 'hotelTheresa',    name: 'Hotel Theresa',               lat: 40.80920, lon: -73.94910, mode: 'decorate' },
  { id: 10, key: 'acpStateOffice',  name: 'A.C. Powell Jr. State Office Bldg', lat: 40.80950, lon: -73.94830, mode: 'decorate' },
  { id: 11, key: 'hamiltonGrange',  name: 'Hamilton Grange',             lat: 40.82140, lon: -73.94710, mode: 'replace' },
  { id: 12, key: 'schomburg',       name: 'Schomburg Center',            lat: 40.81460, lon: -73.94075, mode: 'decorate' },
  { id: 13, key: 'abyssinian',      name: 'Abyssinian Baptist Church',   lat: 40.81635, lon: -73.94085, mode: 'replace' },
  { id: 14, key: 'whittierHall',    name: 'Whittier Hall (Teachers College)', lat: 40.80987, lon: -73.95935, mode: 'decorate' }, // slate roof, dormers, turrets, limestone base (2026-09-15)

  // ---- Skyline icons ----
  { id: 20, key: 'empireState',     name: 'Empire State Building',       lat: 40.74842, lon: -73.98566, mode: 'replace' },
  { id: 21, key: 'chrysler',        name: 'Chrysler Building',           lat: 40.75162, lon: -73.97550, mode: 'replace' },
  { id: 22, key: 'oneWTC',          name: 'One World Trade Center',      lat: 40.71274, lon: -74.01339, mode: 'replace' },
  { id: 23, key: 'thirtyRock',      name: '30 Rockefeller Plaza',        lat: 40.75874, lon: -73.97870, mode: 'replace' },
  { id: 24, key: 'flatiron',        name: 'Flatiron Building',           lat: 40.74106, lon: -73.98964, mode: 'replace' },
  // LM64: the old point (40.75410, -73.97640) fell on the Helmsley Building north of 45th Street, so the MetLife box stood on
  // 230 Park Avenue and the real tower drew as its 47.9 m base; this point is the vertex mean of the MetLife footprint
  // (tile -1_6 #18, BIN 1085630)
  { id: 25, key: 'metLife',         name: 'MetLife Building',            lat: 40.753556, lon: -73.976626, mode: 'replace' },
  { id: 26, key: 'woolworth',       name: 'Woolworth Building',          lat: 40.71240, lon: -74.00834, mode: 'replace' },
  { id: 27, key: 'oneVanderbilt',   name: 'One Vanderbilt',              lat: 40.75290, lon: -73.97869, mode: 'replace' },
  { id: 28, key: 'p432park',        name: '432 Park Avenue',             lat: 40.76160, lon: -73.97190, mode: 'replace' },
  { id: 29, key: 'cpTower',         name: 'Central Park Tower',          lat: 40.76632, lon: -73.98103, mode: 'replace' },
  { id: 30, key: 'steinway',        name: '111 West 57th (Steinway)',    lat: 40.76470, lon: -73.97760, mode: 'replace' },
  { id: 31, key: 'hearst',          name: 'Hearst Tower',                lat: 40.76655, lon: -73.98565, mode: 'replace' },
  { id: 32, key: 'citigroup',       name: 'Citigroup Center',            lat: 40.75880, lon: -73.97020, mode: 'replace' },
  { id: 33, key: 'unSecretariat',   name: 'UN Secretariat',              lat: 40.74900, lon: -73.96800, mode: 'replace' },
  { id: 34, key: 'grandCentral',    name: 'Grand Central Terminal',      lat: 40.75266, lon: -73.97733, mode: 'replace' },
  // Bryant Park's OSM polygon swallows the library parcel: no lawn in a Manhattan-grid box around the
  // building (along the avenue +/-72 m, across from 46 m west of the centre to 56 m east = the 5th Ave
  // kerb). The old 78 m radius left lawn on the 5th Ave corners (critic R4 #8).
  // across reaches the 5th Ave kerb (~80 m east of the centre): the terrace between the library and
  // the avenue is stone, and lawn ran down that strip through critic rounds 4 and 5
  { id: 35, key: 'nypl',            name: 'NY Public Library',           lat: 40.75320, lon: -73.98220, mode: 'replace', noLawnBox: { along: [-72, 72], across: [-46, 84] } },
  { id: 36, key: 'stPatricks',      name: "St. Patrick's Cathedral",     lat: 40.75850, lon: -73.97600, mode: 'replace' },
  { id: 37, key: 'trinityChurch',   name: 'Trinity Church',              lat: 40.70810, lon: -74.01200, mode: 'replace' },
  { id: 38, key: 'federalHall',     name: 'Federal Hall',                lat: 40.70740, lon: -74.01020, mode: 'replace' },
  { id: 39, key: 'nyse',            name: 'NY Stock Exchange',           lat: 40.70690, lon: -74.01130, mode: 'replace' },
  { id: 40, key: 'municipalBldg',   name: 'Municipal Building',          lat: 40.71270, lon: -74.00410, mode: 'replace' },
  // LM65: the old point (40.71790, -74.00480) fell on a 10.8 m shop row (tile -6_14 #100) 120 m east of the tower; this one is the
  // vertex mean of the tower's footprint (tile -6_14 #135, BIN 1088646)
  { id: 41, key: 'p56leonard',      name: '56 Leonard',                  lat: 40.717663, lon: -74.006322, mode: 'replace' },
  { id: 42, key: 'p8spruce',        name: '8 Spruce Street',             lat: 40.71100, lon: -74.00550, mode: 'replace' },
  { id: 43, key: 'msg',             name: 'Madison Square Garden',       lat: 40.75050, lon: -73.99340, mode: 'replace' },
  // LM16 (2026-10-16): the Met draws all its walls (city/lmMetMuseum.js), so 'replace' (the tiles already compiled carry -44:
  // the read-time override LM16 below turns them; `?met16=0` keeps the old decorate builder on the extrusion)
  { id: 44, key: 'metMuseum',       name: 'The Met',                     lat: 40.77940, lon: -73.96320, mode: 'replace' },
  { id: 45, key: 'guggenheim',      name: 'Guggenheim Museum',           lat: 40.78300, lon: -73.95900, mode: 'replace' },
  // LM16 (2026-10-16): the museum is modelled whole (city/lmAmnh.js), so it replaces the extrusion; its north side (the Gilder
  // Center, the 81st Street terrace, tile -1_0 #211) is its own footprint, id 78 below
  { id: 46, key: 'amnh',            name: 'Museum of Natural History',   lat: 40.78130, lon: -73.97400, mode: 'replace' },
  { id: 47, key: 'dakota',          name: 'The Dakota',                  lat: 40.77650, lon: -73.97610, mode: 'decorate' },
  // CP33: the old point (40.77490, -73.97660) was 370 m south-west of the San Remo, on an 18-storey block at Columbus Avenue
  // and W 73rd (the twin-tower builder had replaced that block; the San Remo stayed a plain 120 m extrusion). This point is
  // the pole of inaccessibility of the San Remo's compiled footprint (tile -1_1 #13, 145-146 Central Park West, 10 m clear
  // of every wall, in the wing behind the park front); a recompile marks it, the read-time overrides at the end of this
  // file (CP33) do the same on the tiles already built
  { id: 48, key: 'sanRemo',         name: 'The San Remo',                lat: 40.777914, lon: -73.975386, mode: 'replace' },
  { id: 49, key: 'plaza',           name: 'The Plaza',                   lat: 40.76450, lon: -73.97440, mode: 'decorate' },
  { id: 50, key: 'waldorf',         name: 'Waldorf Astoria',             lat: 40.75640, lon: -73.97430, mode: 'decorate' },
  // LM65: the old point (40.70740, -74.00890) fell on a 22 m building at Pine and William Streets (tile -7_16 #23); this one is
  // the tower's axis inside 40 Wall Street's footprint (tile -7_16 #47, BIN 1001018)
  { id: 51, key: 'p40wall',         name: '40 Wall Street',              lat: 40.706963, lon: -74.009672, mode: 'replace' },
  { id: 52, key: 'p70pine',         name: '70 Pine Street',              lat: 40.70630, lon: -74.00740, mode: 'replace' },
  { id: 53, key: 'p28liberty',      name: '28 Liberty',                  lat: 40.70805, lon: -74.00885, mode: 'replace' },
  { id: 54, key: 'seagram',         name: 'Seagram Building',            lat: 40.75850, lon: -73.97220, mode: 'replace' },
  { id: 55, key: 'leverHouse',      name: 'Lever House',                 lat: 40.75980, lon: -73.97240, mode: 'replace' },
  { id: 56, key: 'metOpera',        name: 'Metropolitan Opera House',    lat: 40.77280, lon: -73.98430, mode: 'replace' },
  { id: 57, key: 'oneTimesSquare',  name: 'One Times Square',            lat: 40.75630, lon: -73.98660, mode: 'replace' },
  { id: 58, key: 'boaTower',        name: 'Bank of America Tower',       lat: 40.75550, lon: -73.98450, mode: 'replace' },
  { id: 59, key: 'p30hudson',       name: '30 Hudson Yards',             lat: 40.75390, lon: -74.00110, mode: 'replace' },
  { id: 60, key: 'one57',           name: 'One57',                       lat: 40.76545, lon: -73.97875, mode: 'replace' },
  // CP33 (the Central Park South skyline the teaser frames): decorate builders on the rooftops; points are the poles of
  // inaccessibility of the compiled footprints (tile -2_3 #37 and #50)
  { id: 61, key: 'essexHouse',      name: 'Essex House (160 Central Park South)', lat: 40.766182, lon: -73.978516, mode: 'decorate' },
  { id: 62, key: 'hampshireHouse',  name: 'Hampshire House (150 Central Park South)', lat: 40.766044, lon: -73.977978, mode: 'decorate' },
  // CW38 (Central Park West's tower houses, city/lmCPW.js): each compiled footprint is one ring at the towers' height; the
  // points sit 8 m behind the park front, mid-block, inside the U's front bar (the read-time overrides below do the same
  // on the tiles already built)
  { id: 63, key: 'majestic',        name: 'The Majestic (115 Central Park West)',  lat: 40.775957, lon: -73.976454, mode: 'replace' },
  { id: 64, key: 'century',         name: 'The Century (25 Central Park West)',    lat: 40.770316, lon: -73.980561, mode: 'replace' },
  { id: 65, key: 'eldorado',        name: 'The Eldorado (300 Central Park West)',  lat: 40.788273, lon: -73.967478, mode: 'replace' },
  { id: 66, key: 'beresford',       name: 'The Beresford (211 Central Park West)', lat: 40.782497, lon: -73.971690, mode: 'replace' },
  // LB39 (city/liberty.js): the Statue of Liberty, her pedestal and Fort Wood, resident and drawn by their own module; the
  // point is inside the compiled footprint of the fort's star (tile -13_20), which the builder replaces by nothing
  { id: 67, key: 'statueOfLiberty', name: 'Statue of Liberty (Liberty Enlightening the World), pedestal and Fort Wood', lat: 40.689266, lon: -74.044581, mode: 'replace' },
  // LB39: Liberty Island's other buildings (the museum, the pavilions, the service buildings), drawn by city/libertyIsland.js
  // on their OpenStreetMap footprints; the compiled footprints there are replaced by nothing
  { id: 68, key: 'libertyIslandBuilding', name: 'Liberty Island building (city/libertyIsland.js)', lat: 40.690849, lon: -74.046412, mode: 'replace' },
  // TW (towers lane, city/tk/tkLandmarks.js): the towers that hold the skyline from Central Park, points inside the compiled
  // footprints (client/tools/towers census: tile and index in the comment)
  { id: 70, key: 'tw220cps',        name: '220 Central Park South',      lat: 40.767050, lon: -73.980337, mode: 'replace' },   // -2_3:57
  { id: 71, key: 'twTimeWarner',    name: 'Deutsche Bank Center (Time Warner Center)', lat: 40.768470, lon: -73.982969, mode: 'replace' },   // -2_3:4
  { id: 72, key: 'twGM',            name: 'General Motors Building',     lat: 40.763562, lon: -73.972301, mode: 'replace' },   // -1_4:56
  { id: 73, key: 'twSherry',        name: 'The Sherry-Netherland',       lat: 40.764318, lon: -73.972531, mode: 'replace' },   // -1_4:147
  { id: 74, key: 'twTrumpIntl',     name: '1 Central Park West',         lat: 40.769118, lon: -73.981570, mode: 'replace' },   // -2_3:14
  { id: 75, key: 'tw53w53',         name: '53 West 53rd',                lat: 40.761815, lon: -73.978094, mode: 'replace' },   // LF39 (BIN 1090777)
  { id: 76, key: 'tw520park',       name: '520 Park Avenue',             lat: 40.764030, lon: -73.970024, mode: 'replace' },   // 0_4:194
  { id: 77, key: 'tw270park',       name: '270 Park Avenue',             lat: 40.755978, lon: -73.975968, mode: 'replace' },   // -1_5:106
  // /TW
  // LM16: the AMNH's north side (city/lmAmnh.js buildAmnhNorth); the point is inside the compiled footprint (tile -1_0 #211)
  { id: 78, key: 'amnhNorth',       name: 'Museum of Natural History, north side (Gilder Center, 81st Street terrace)', lat: 40.781899, lon: -73.974332, mode: 'replace' },
  // HB25: the Highbridge Water Tower (city/lmHighbridgeTower.js) on its compiled ring (tile 6_-13 #8, OSM way 275059317)
  { id: 79, key: 'highbridgeTower', name: 'Highbridge Water Tower',      lat: 40.842543, lon: -73.932619, mode: 'replace' },
  // LM63 (2026-10-30): City Hall, drawn until now as a generic 36.6 m extrusion of its plan (city/lmCivic.js buildCityHall)
  { id: 80, key: 'cityHallNY',      name: 'New York City Hall',          lat: 40.71275, lon: -74.00597, mode: 'replace' },
  // LM64 (2026-10-30): the Helmsley Building, 230 Park Avenue (city/lmGCT.js buildHelmsley), on its compiled footprint (tile
  // -1_6 #32, BIN 1036185; the point is the footprint's vertex mean)
  { id: 81, key: 'helmsley',        name: 'Helmsley Building (230 Park Avenue)', lat: 40.754399, lon: -73.976102, mode: 'replace' },
  // LM65 (2026-10-31): the World Trade Center Transportation Hub (city/lmWTC.js buildOculus) on its compiled footprint (tile -7_15
  // #36, BIN 1089309, a 33 m extrusion until now; the point is the footprint's vertex mean)
  { id: 82, key: 'oculus',          name: 'World Trade Center Transportation Hub (Oculus)', lat: 40.711522, lon: -74.011407, mode: 'replace' },
  // LM65: Brookfield Place's four towers (tile -8_15 #15, #13, #16; -8_14 #21), the Winter Garden (-8_15 #22, compiled at Two's
  // 197 m) and 14 Wall Street (-7_16 #68) from the city's 3D building model (city/lmDowntown.js); points well inside each footprint
  { id: 83, key: 'wfc1',            name: 'One World Financial Center (200 Liberty Street)', lat: 40.71055, lon: -74.015588, mode: 'replace' },
  { id: 84, key: 'wfc2',            name: 'Two World Financial Center (225 Liberty Street)', lat: 40.712487, lon: -74.015414, mode: 'replace' },
  { id: 85, key: 'wfc3',            name: 'Three World Financial Center (200 Vesey Street)', lat: 40.713576, lon: -74.014842, mode: 'replace' },
  { id: 86, key: 'wfc4',            name: 'Four World Financial Center (250 Vesey Street)', lat: 40.714058, lon: -74.015912, mode: 'replace' },
  { id: 87, key: 'winterGarden',    name: 'Winter Garden, Brookfield Place', lat: 40.713081, lon: -74.015372, mode: 'replace' },
  { id: 88, key: 'wall14',          name: '14 Wall Street (Bankers Trust Company Building)', lat: 40.707667, lon: -74.010757, mode: 'replace' },
  // LM65: the Battery's ferry terminals (tile -7_17 #68 and #55) from the city's 3D building model (city/lmDowntown.js)
  { id: 89, key: 'whitehallTerminal', name: 'Whitehall Terminal (Staten Island Ferry)', lat: 40.70097, lon: -74.013039, mode: 'replace' },
  { id: 90, key: 'batteryMaritime', name: 'Battery Maritime Building', lat: 40.701086, lon: -74.011647, mode: 'replace' },
  // LM65: St. Paul's Chapel on Broadway (tile -7_15 #57, compiled as a 60.7 m block: the footprint's height is the steeple's)
  { id: 91, key: 'stPaulsBroadway', name: "St. Paul's Chapel (Broadway)", lat: 40.711311, lon: -74.009164, mode: 'replace' },
  // LM65: the Battery's Castle Clinton (tile -8_17 #13) and Pier A (tile -8_17 #7)
  { id: 92, key: 'castleClinton',   name: 'Castle Clinton National Monument', lat: 40.703447, lon: -74.016813, mode: 'replace' },
  { id: 93, key: 'pierA',           name: 'Pier A Harbor House', lat: 40.704462, lon: -74.017478, mode: 'replace' },
  // LM66 (2026-10-31): Hudson Yards (city/lmHY.js), each point the vertex mean of its compiled footprint (30 Hudson Yards and
  // the Shops keep id 59 on their lot, tile -5_6 #61)
  { id: 100, key: 'hy10',            name: '10 Hudson Yards',             lat: 40.752763, lon: -74.001565, mode: 'replace' },   // -5_6 #17
  { id: 101, key: 'hy35',            name: '35 Hudson Yards',             lat: 40.754640, lon: -74.002261, mode: 'replace' },   // -6_6 #18
  { id: 102, key: 'hy15',            name: '15 Hudson Yards and The Shed', lat: 40.753407, lon: -74.002880, mode: 'replace' },  // -6_6 #28
  { id: 103, key: 'hy50',            name: '50 Hudson Yards',             lat: 40.754529, lon: -74.000108, mode: 'replace' },   // -5_6 #31
  { id: 104, key: 'hy55',            name: '55 Hudson Yards',             lat: 40.755171, lon: -74.001740, mode: 'replace' },   // -6_6 #51
  { id: 105, key: 'hySpiral',        name: 'The Spiral (66 Hudson Boulevard)', lat: 40.755278, lon: -73.999489, mode: 'replace' },   // -5_6 #59
  { id: 106, key: 'hyVessel',        name: 'The Vessel and the Public Square', lat: 40.753855, lon: -74.002236, mode: 'replace' },   // -6_6 #36
  { id: 107, key: 'hyNone',          name: 'Hudson Yards footprint drawn by a neighbouring builder', lat: 40.753676, lon: -74.002163, mode: 'replace' },   // -6_6 #38
  // UN67 (2026-11-01): the United Nations' General Assembly and Conference Buildings from the city's 3D building model
  // (city/lmMid2.js buildUNCampus); the point is the General Assembly's dome (tile 0_7 #4)
  { id: 108, key: 'unCampus',        name: 'UN General Assembly and Conference Buildings', lat: 40.750092, lon: -73.967714, mode: 'replace' },
];
// TW: the points of four landmarks that fell on the wrong footprint in the five-borough compile (each now inside its own;
// 30 Rockefeller Plaza's 28 m inside the complex's ring of the live tiles and of runs 7-9, the point the records lane gave)
{
  const fix = { 23: [40.758977, -73.979196], 31: [40.766518, -73.983557], 32: [40.758504, -73.970086], 50: [40.756511, -73.973347], 60: [40.765590, -73.979071] };
  for (const l of LANDMARKS) if (fix[l.id]) { l.lat = fix[l.id][0]; l.lon = fix[l.id][1]; }
}
// /TW
// AR32C (city/w125c.js): the 125th Street part builds the Apollo's front itself (the terracotta, the marquee, the blade
// sign); the old decorate builder's red and white boxes are kept off by giving the entry, in the browser only, a key no
// builder has (the compiled footprint keeps its landmark id). `?ar32c=0` or `?ar32=0` restores it.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q && q.get('ar32c') !== '0' && q.get('ar32') !== '0') { const a = LANDMARKS.find((l) => l.id === 8); if (a) a.key = 'apolloTheaterAR32C'; }
}
// /AR32C

// District style overrides — polygon (lon/lat) forcing palette/behavior.
export const DISTRICTS = [
  { key: 'columbia', style: 'COLUMBIA_CAMPUS', // full Morningside superblock: 114th-120th, Broadway-Amsterdam (property lines, fit from CSCL)
    poly: [[-73.96465, 40.80674], [-73.9621, 40.80566], [-73.95945, 40.80929], [-73.96203, 40.81037]] },
  // Teachers College block (W 120th-121st, Amsterdam-Broadway): red brick + limestone Collegiate Gothic halls, no shops,
  // no fire escapes, no wooden tanks (the reference views; owner 2026-09-15)
  { key: 'teachersCollege', style: 'TEACHERS_COLLEGE',
    poly: [[-73.95945, 40.80929], [-73.96203, 40.81037], [-73.96157, 40.81100], [-73.95899, 40.80992]] },
  { key: 'soho', style: 'CAST_IRON',
    poly: [[-74.0043, 40.7194], [-73.9959, 40.7228], [-73.9975, 40.7266], [-74.0053, 40.7237]] },
  { key: 'timessq', style: 'BILLBOARDS',
    poly: [[-73.9890, 40.7546], [-73.9856, 40.7541], [-73.9838, 40.7594], [-73.9873, 40.7599]] },
];

// Per-building TRUTH overrides (owner 2026-09-15): a (lat, lon) inside the footprint plus the facade facts read off
// reference imagery (reference only, never shipped). The compiler applies them AFTER
// classify() and the district rules, so a campus building can escape the McKim copper-roof treatment when it is a
// 1961 brick tower. Fields: style (STYLE key), color [r,g,b], roofKind shape (0 flat, 1 gable, 2 hip), floors,
// floorH, winW, storeH, set/clear (BF flag names), wall (nycDress wall family, applied at read time only). Missing fields
// keep the classifier's value.
export const BUILDING_OVERRIDES = [
  // ---- Brooklyn Bridge Park, Pier 1's land side (the reference view: classed as blue glass towers, they drew as dark slabs) ----
  { key: 'oneHotelBbp', name: '1 Hotel Brooklyn Bridge, 60 Furman St (2017): reclaimed brick and charcoal panels, big glazing (tile -5_17 #2)',
    lat: 40.70224, lon: -73.99554, style: 'CONDO_NEW', color: [96, 86, 78], clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE'] },
  { key: 'pierhouseBbp', name: 'Pierhouse, 90 Furman St (2016): pale stone-coloured panels and glass (tile -5_17 #1)',
    lat: 40.70163, lon: -73.99596, style: 'CONDO_NEW', color: [204, 194, 176], clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE'] },
  // ---- W 120th St & Amsterdam Ave, Morningside Heights (the reference views) ----
  { key: 'muddHall', name: 'Seeley W. Mudd Hall (Columbia Engineering, 1961)', lat: 40.80939, lon: -73.96005,
    // PROJECT_BRICK = red-brown brick, regular small windows, no cornice/sills/AC clutter: the closest style to a 1961
    // engineering tower (the critic read the PREWAR_APT version as an apartment block, docs/notes/amst120-critic.md)
    style: 'PROJECT_BRICK', color: [112, 60, 46], roofKind: 0, floors: 14, floorH: 4.6, winW: 1.8, storeH: 0,
    clear: ['CORNICE', 'WATERTOWER', 'STOREFRONT', 'SETBACKS', 'FIRE_ESCAPE'] },
  // CR24: the old point (40.80957, -73.96043) fell in a 32 m2 sliver between CEPSR and Mudd; this one is inside CEPSR.
  // 2026-11-03: pale stone-coloured cladding in a grid of punched windows under a flat grey roof with a pale penthouse box
  // (the reference north and oblique views); the copper mansard read for it was Havemeyer's, in front of it in those views
  { key: 'schapiroCepsr', name: 'Schapiro CEPSR (Columbia, 1992)', lat: 40.809604, lon: -73.960750,
    style: 'POSTWAR_BRICK', color: [196, 190, 178], roofKind: 0, storeH: 0, noBalc: true,
    clear: ['CORNICE', 'WATERTOWER', 'STOREFRONT', 'SETBACKS'] },
  { key: 'whittierHall', name: 'Whittier Hall (Teachers College, 1901): red brick, limestone base', lat: 40.80978, lon: -73.95914,   // 3 m in from the Amsterdam wall: the centroid falls in a court
    // 11 storeys to the eave (two-storey rusticated limestone base, eight of brick, the gabled attic): the data's 9 x 4.8 m
    // put the base's water-table course across the second-floor windows (owner 2026-09-24, the white line)
    style: 'PREWAR_APT', color: [158, 74, 52], roofKind: 0, storeH: 0, floors: 11, floorH: 3.65,
    set: ['CORNICE'], clear: ['STOREFRONT', 'WATERTOWER', 'FIRE_ESCAPE'] },
  { key: 'tcLowWing', name: 'Teachers College low wing on W 120th', lat: 40.80983, lon: -73.95953,
    style: 'PREWAR_APT', color: [158, 74, 52], roofKind: 0, storeH: 0, clear: ['STOREFRONT', 'WATERTOWER'] },
  // ---- COLUMBIA MORNINGSIDE CAMPUS ROOFS (CR24, owner 2026-09-24: "Columbia buildings' roofs are missing"). Read off the reference views (top, north, east and
  // west; reference only, never shipped). `roof` is runtime-only (tiledata.js -> assemble.js crPlan): form 'mansard'
  // (steep copper holding the attic storey, flat top), 'hip' (to a ridge), 'dome', 'flat'; tone 'mint' (verdigris) or 'pale'
  // (the grey-green of Kent, Hamilton, Journalism, Havemeyer); dormers (row density, 0 = none); chimneys (count); domes
  // (observatory domes on the top). Points are the pole of inaccessibility of each compiled footprint.
  { key: 'cuHavemeyer', name: 'Havemeyer Hall', lat: 40.809311, lon: -73.962214, roofKind: 2, roof: { form: 'mansard', tone: 'pale', dormers: 1, chimneys: 2 } },
  { key: 'cuSchermerhorn', name: 'Schermerhorn Hall', lat: 40.808560, lon: -73.960426, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 0.8, chimneys: 2 } },
  { key: 'cuAvery', name: 'Avery Hall', lat: 40.808379, lon: -73.960863, roofKind: 2, roof: { form: 'hip', tone: 'mint', dormers: 0 } },
  { key: 'cuFayerweather', name: 'Fayerweather Hall (the chapel landmark had been placed here)', lat: 40.808131, lon: -73.960432, landmarkId: 0, roofKind: 2, roof: { form: 'hip', tone: 'mint', dormers: 0 } },
  { key: 'cuStPauls', name: 'St. Paul\'s Chapel footprint (landmark builder)', lat: 40.807854, lon: -73.960942, landmarkId: 3 },
  { key: 'cuPhilosophy', name: 'Philosophy Hall', lat: 40.807489, lon: -73.960901, roofKind: 2, roof: { form: 'hip', tone: 'mint', dormers: 0.6, chimneys: 2 } },
  { key: 'cuBuell', name: 'Buell Hall (1885): slate', lat: 40.807715, lon: -73.961427, roofKind: 2, roof: { form: 'hip', tone: 'slate', dormers: 0, pitch: 42 } },
  { key: 'cuEarl', name: 'Earl Hall: pale dome', lat: 40.808602, lon: -73.962707, roofKind: 2, roof: { form: 'dome', tone: 'lead' } },
  { key: 'cuMathematics', name: 'Mathematics Hall', lat: 40.809107, lon: -73.962674, roofKind: 2, roof: { form: 'hip', tone: 'mint', dormers: 0.6 } },
  { key: 'cuLewisohn', name: 'Lewisohn Hall', lat: 40.808349, lon: -73.963224, roofKind: 2, roof: { form: 'hip', tone: 'mint', dormers: 0.7 } },
  { key: 'cuJournalism', name: 'Pulitzer Hall (Journalism)', lat: 40.808064, lon: -73.963401, roofKind: 2, roof: { form: 'mansard', tone: 'pale', dormers: 1 } },
  { key: 'cuKent', name: 'Kent Hall', lat: 40.807235, lon: -73.961388, roofKind: 2, roof: { form: 'mansard', tone: 'pale', dormers: 1, chimneys: 2 } },
  { key: 'cuDodge', name: 'Dodge Hall', lat: 40.807530, lon: -73.963326, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 1 } },
  { key: 'cuFurnald', name: 'Furnald Hall', lat: 40.807502, lon: -73.963830, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 1.2, chimneys: 3 } },
  { key: 'cuHamilton', name: 'Hamilton Hall', lat: 40.806881, lon: -73.961770, roofKind: 2, roof: { form: 'mansard', tone: 'pale', dormers: 1, chimneys: 2 } },
  { key: 'cuHartley', name: 'Hartley Hall', lat: 40.806325, lon: -73.961760, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 1.2, chimneys: 3 } },
  { key: 'cuWallach', name: 'Wallach Hall', lat: 40.806041, lon: -73.961968, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 1.2, chimneys: 3 } },
  { key: 'cuJohnJay', name: 'John Jay Hall', lat: 40.805905, lon: -73.962362, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 1.2, chimneys: 4 } },
  { key: 'cuPupin', name: 'Pupin Hall: copper with the Rutherfurd Observatory domes', lat: 40.809925, lon: -73.961203, roofKind: 2, roof: { form: 'mansard', tone: 'mint', dormers: 0.6, domes: 2 } },
  // post-war and late-modern buildings: flat roofs (Uris 1964, Carman 1959, Fairchild 1977, Lerner 1999, NW Corner 2010...)
  { key: 'cuNwCorner', name: 'Northwest Corner Building', lat: 40.810180, lon: -73.961882, roofKind: 0, roof: { form: 'flat' } },
  { key: 'cuFairchild', name: 'Sherman Fairchild Center', lat: 40.809139, lon: -73.960331, roofKind: 0, roof: { form: 'flat' } },
  { key: 'cuEngTerrace', name: 'Engineering Terrace', lat: 40.809040, lon: -73.959845, roofKind: 0, roof: { form: 'flat' } },
  { key: 'cuSchermerhornExt', name: 'Schermerhorn Extension', lat: 40.808653, lon: -73.960064, roofKind: 0, roof: { form: 'flat' } },
  // 2026-11-03: Uris Hall (1964; the compiled record holds University Hall's round gym too) in beige concrete, a grid of
  // piers and dark recessed windows under flat roofs (the reference oblique views), not the brick apartment style dealt it
  { key: 'cuUris', name: 'Uris Hall', lat: 40.809021, lon: -73.961266, style: 'DECO_MASONRY', color: [190, 180, 160], roofKind: 0, roof: { form: 'flat' },
    clear: ['CORNICE', 'WATERTOWER', 'STOREFRONT', 'FIRE_ESCAPE', 'SETBACKS'] },
  { key: 'cuChandler', name: 'Chandler Hall', lat: 40.809612, lon: -73.962291, roofKind: 0, roof: { form: 'flat' } },
  { key: 'cuAveryPlaza', name: 'the plaza over the Avery extension', lat: 40.808294, lon: -73.960603, roofKind: 0, memb: 3, roof: { form: 'flat' } },
  // 2026-11-03: the gym's round roof is a dark membrane inside a pale parapet (the reference north and oblique views); the
  // hash had dealt it the silver coating, white with the ponding's blue
  { key: 'cuUniversityHall', name: 'University Hall (the gym\'s round roof)', lat: 40.809262, lon: -73.961077, roofKind: 0, memb: 1, roof: { form: 'flat' } },
  { key: 'cuLerner', name: 'Alfred Lerner Hall', lat: 40.806864, lon: -73.963942, roofKind: 0, roof: { form: 'flat' } },
  { key: 'cuCarman', name: 'Carman Hall', lat: 40.806719, lon: -73.964391, roofKind: 0, roof: { form: 'flat' } },
  // the ground floors of the two east corners are modelled shop by shop in src/city/namedShops.js (Appletree Market / Deli
  // on 1225; Hartley Chemist, Hartley Pharmacy, Sliced, Suzi Confections on 1217-1219): the procedural storefront is off,
  // which also puts the residential limestone base back on their W 120th sides (refs: no shops there)
  { key: 'amst1225', name: 'NE corner: 1225 Amsterdam, tan pre-war apartments over Appletree Market', lat: 40.80945, lon: -73.95873,
    style: 'PREWAR_APT', color: [196, 172, 132], wall: 'brickTan', base: { wall: 'limestone', floors: 2 }, roofKind: 0, set: ['CORNICE'], clear: ['FIRE_ESCAPE', 'STOREFRONT'] },
  { key: 'amstSE120', name: 'SE corner: 1217-1219 Amsterdam, buff brick over a limestone base, Hartley Chemist', lat: 40.80897, lon: -73.95900,
    style: 'PREWAR_APT', color: [190, 166, 128], wall: 'brickTan', base: { wall: 'limestone', floors: 3 }, roofKind: 0, set: ['CORNICE'], clear: ['FIRE_ESCAPE', 'STOREFRONT'] },
];
// AR32C (city/w125c.js, docs/notes/area-w125c.md): 125th Street's landmarks on their real footprints, read-time only (the
// browser, world/tiledata.js; `?ar32c=0` or `?ar32=0` keeps the compiled records). The compile had put Hotel Theresa's
// point (id 9) on a 10.4 m shop row (#202) beside the Theresa and the State Office Building's (id 10) on a 26.1 m block west of
// the boulevard; the Theresa is the 51.5 m, 12-storey footprint between 124th and 125th Streets west of the boulevard
// (Wikipedia: "2082-96 Adam Clayton Powell Jr. Boulevard between West 124th and 125th Streets", 13 storeys, white
// terracotta) and the State Office Building the 88.9 m, 19-storey tower east of it (163 W 125th St). Points are the
// footprints' centroids (client/tools/ar32/w125c_inside.mjs: each lies inside its footprint).
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q && q.get('ar32c') !== '0' && q.get('ar32') !== '0') BUILDING_OVERRIDES.push(
    { key: 'ar32cShopRow', name: 'shop row at 125th St and ACP Blvd (not the Theresa)', lat: 40.808924, lon: -73.949173, landmarkId: 0 },
    { key: 'ar32cTheresa', name: 'Hotel Theresa (1913, George & Edward Blum): white terracotta, 13 storeys', lat: 40.808761, lon: -73.948930,
      landmarkId: -9, color: [226, 223, 214], wall: 'limestone' },
    { key: 'ar32cWestOfAcp', name: 'block west of ACP Blvd (not the State Office Building)', lat: 40.809595, lon: -73.948399, landmarkId: 0 },
    { key: 'ar32cStateOffice', name: 'Adam Clayton Powell Jr. State Office Building (1973), 19 storeys', lat: 40.809219, lon: -73.947423, landmarkId: -10 },
    // the Apollo's lobby (a point 3 m inside its frontage): the part builds the ground floor under the marquee, so the
    // procedural shop fronts and awnings (they stood out under the marquee in the r1 stills) are off
    { key: 'ar32cApollo', name: 'Apollo Theater lobby, 253 W 125th St', lat: 40.809923, lon: -73.950126, clear: ['STOREFRONT'] },
  );
}
// /AR32C

// CP33 (landmarks round, 2026-09-30; owner on teaser 4: the park's surroundings must not read as flat low-poly blocks).
// Read-time like the AR32C entries (world/tiledata.js applies them when a tile is read; `?rto=0` disables them): each point is
// the pole of inaccessibility of its compiled footprint (client/tools/ar33 style probe: tile and index in the name).
// - the San Remo's landmark id (48) sat on an 18-storey block at Columbus and W 73rd (tile -1_1 #36), 370 m from the building,
//   so the twin-tower builder drew that block and the real San Remo (tile -1_1 #13) stayed a plain 120 m extrusion
// - One57's id (60) sat on a 31 m 9-storey building (tile -2_3 #81) beside the tower, which the blue-glass builder had replaced
// - the Plaza (tile -1_4 #130, decorate id 49): white glazed brick and marble under the green mansard (the compiled colour was
//   a dirty tan, [211, 203, 180]); the Essex House (tile -2_3 #37) takes the new decorate id 61 (the red roof sign);
//   Hampshire House (tile -2_3 #50) a steep verdigris copper roof with chimneys through the CR24 roof table
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('cp33lm') !== '0') BUILDING_OVERRIDES.push(
    { key: 'cp33SanRemo', name: 'The San Remo, 145-146 Central Park West (tile -1_1 #13)', lat: 40.777914, lon: -73.975386, landmarkId: 48 },
    { key: 'cp33NotSanRemo', name: 'the 18-storey block at Columbus and W 73rd that id 48 had replaced (tile -1_1 #36)', lat: 40.775502, lon: -73.976816, landmarkId: 0 },
    { key: 'cp33NotOne57', name: 'the 9-storey building beside One57 that id 60 had replaced (tile -2_3 #81)', lat: 40.765646, lon: -73.978591, landmarkId: 0 },
    { key: 'cp33Plaza', name: 'The Plaza (1907): white glazed brick and marble', lat: 40.764439, lon: -73.974378, color: [236, 232, 222], wall: 'limestone',
      clear: ['SETBACKS'] },   // the compiled stepping tiers are not the Plaza: one wall to the cornice, the mansard (city/lmPlaza.js) above it
    { key: 'cp33Essex', name: 'Essex House (1931): the roof sign', lat: 40.766182, lon: -73.978516, landmarkId: -61 },
    { key: 'cp33Hampshire', name: 'Hampshire House (1937): the steep copper roof with its chimneys (city/lmPlaza.js)', lat: 40.766089, lon: -73.977909,
      landmarkId: -62, clear: ['SETBACKS'] },
  );
}
// CW38 (records lane, 2026-10-11): the Central Park West tower houses on the tiles already compiled (live set run 6), the
// same points as their LANDMARKS entries; `?cw38=0` leaves them to the tile (one footprint, the tower pass's crown)
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('cw38') !== '0') BUILDING_OVERRIDES.push(
    { key: 'cw38Majestic', name: 'The Majestic, 115 Central Park West (tile -1_1 #6)', lat: 40.775957, lon: -73.976454, landmarkId: 63 },
    { key: 'cw38Century', name: 'The Century, 25 Central Park West (tile -2_2 #22)', lat: 40.770316, lon: -73.980561, landmarkId: 64 },
    { key: 'cw38Eldorado', name: 'The Eldorado, 300 Central Park West (tile 0_-2 #73)', lat: 40.788273, lon: -73.967478, landmarkId: 65 },
    { key: 'cw38Beresford', name: 'The Beresford, 211 Central Park West (tile -1_0 #175)', lat: 40.782497, lon: -73.971690, landmarkId: 66 },
  );
}
// LM16 (landmarks round, 2026-10-16): the AMNH on the tiles already compiled, the same ids as its LANDMARKS entries: the main
// block (tile -1_0 #82, compiled as a decorate, -46) replaced by city/lmAmnh.js buildAmnh, the north side (#211, no id)
// by buildAmnhNorth; each point 10+ m inside its footprint; `?lm16=0` leaves both to the tile (and landmarks.js the old builder)
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lm16') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm16Amnh', name: 'American Museum of Natural History, 77th Street to the Rose Center (tile -1_0 #82)', lat: 40.781112, lon: -73.974907, landmarkId: 46 },
    { key: 'lm16AmnhNorth', name: 'AMNH north side: Gilder Center, 81st Street terrace (tile -1_0 #211)', lat: 40.781899, lon: -73.974332, landmarkId: 78 },
  );
}
// LM63: City Hall's ring on the tiles already compiled (tile -6_15 #66, no id) to its builder; `?lm63=0` leaves the extrusion
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lm63') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm63CityHall', name: 'New York City Hall (tile -6_15 #66)', lat: 40.71275, lon: -74.00597, landmarkId: 80 },
  );
}
// HB25: the Highbridge Water Tower's ring (tile 6_-13 #8, a 47.9 m octagon drawn as a cream prism) to its builder; `?hb25=0` leaves it
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('hb25') !== '0') BUILDING_OVERRIDES.push(
    { key: 'hb25Tower', name: 'Highbridge Water Tower (tile 6_-13 #8)', lat: 40.842543, lon: -73.932619, landmarkId: 79 },
  );
}
// LB39 (landmarks lane, 2026-10-11): the Statue of Liberty's footprint on the tiles already compiled (live set run 6: the star
// fort as a 36 m prism, tile -13_20 #3), the same point as its LANDMARKS entry; `?lb39=0` leaves the tile's prism
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lb39') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lb39Liberty', name: 'Fort Wood under the Statue of Liberty (tile -13_20)', lat: 40.689266, lon: -74.044581, landmarkId: 67 },
    // the island's ten other compiled footprints (tile -13_20; each point 4-18 m clear inside its footprint)
    ...[[40.69039, -74.046758], [40.690731, -74.047042], [40.689683, -74.044913], [40.689867, -74.04714], [40.690849, -74.046412],
      [40.69049, -74.046494], [40.689993, -74.046065], [40.690506, -74.04694], [40.689622, -74.046235], [40.689741, -74.044259]]
      .map(([lat, lon], i) => ({ key: 'lb39Island' + i, name: 'Liberty Island compiled footprint (city/libertyIsland.js draws the island)', lat, lon, landmarkId: 68 })),
  );
}
// /CP33

// TW (towers lane, docs/notes/r2-towers.md): read-time, like CP33 (`?rto=0` disables them; `?twlm=0` too): the towers lane's
// landmark ids on the tiles already built, the wrong footprints cleared, and 30 Rockefeller Plaza's height (the compiled
// footprint carries 10.0 m; the live footprint dataset 254.4 m to the roof, 259 m to the parapet)
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || (q.get('twlm') !== '0')) BUILDING_OVERRIDES.push(
    { key: 'twOne57', name: 'One57 (tile -2_3 #13)', lat: 40.765590, lon: -73.979071, landmarkId: 60 },
    { key: 'twHearst', name: 'Hearst Tower, 959 Eighth Avenue (tile -3_3 #212)', lat: 40.766518, lon: -73.983557, landmarkId: 31 },
    { key: 'twNotHearst', name: '347 W 55th St, which id 31 had replaced (tile -3_3 #126)', lat: 40.766393, lon: -73.985586, landmarkId: 0 },
    { key: 'twCitigroup', name: 'Citigroup Center, 601 Lexington (tile 0_5 #208)', lat: 40.758504, lon: -73.970086, landmarkId: 32 },
    { key: 'twNotCitigroup', name: '641 Lexington, which id 32 had replaced (tile 0_5 #51)', lat: 40.758986, lon: -73.969887, landmarkId: 0 },
    { key: 'twWaldorf', name: 'Waldorf Astoria, 301 Park (tile -1_5 #82)', lat: 40.756511, lon: -73.973347, landmarkId: -50 },
    { key: 'twNotWaldorf', name: '299 Park, which id 50 had decorated (tile -1_5 #20)', lat: 40.756039, lon: -73.974177, landmarkId: 0 },
    { key: 'tw30Rock', name: '30 Rockefeller Plaza (tile -2_5 #177; #179 in runs 7-9)', lat: 40.758977, lon: -73.979196, landmarkId: 23, height: 259, floors: 70 },
    { key: 'twNot30Rock', name: 'the 4.6 m building id 23 had replaced (tile -2_5 #169)', lat: 40.758856, lon: -73.978291, landmarkId: 0 },
    { key: 'twNot30Rock7', name: 'the 3.7 m building id 23 fell to in runs 7-9 (tile -2_5 #178)', lat: 40.758458, lon: -73.978577, landmarkId: 0 },
    { key: 'tw220cps', name: '220 Central Park South (tile -2_3 #57)', lat: 40.767050, lon: -73.980337, landmarkId: 70 },
    { key: 'twTimeWarner', name: 'Deutsche Bank Center (tile -2_3 #4)', lat: 40.768470, lon: -73.982969, landmarkId: 71 },
    { key: 'twGM', name: 'General Motors Building (tile -1_4 #56)', lat: 40.763562, lon: -73.972301, landmarkId: 72 },
    { key: 'twSherry', name: 'The Sherry-Netherland (tile -1_4 #147)', lat: 40.764318, lon: -73.972531, landmarkId: 73 },
    { key: 'twTrumpIntl', name: '1 Central Park West (tile -2_3 #14)', lat: 40.769118, lon: -73.981570, landmarkId: 74 },
    { key: 'tw53w53', name: '53 West 53rd (LF39, BIN 1090777)', lat: 40.761815, lon: -73.978094, landmarkId: 75 },
    { key: 'tw520park', name: '520 Park Avenue (tile 0_4 #194)', lat: 40.764030, lon: -73.970024, landmarkId: 76 },
    { key: 'tw270park', name: '270 Park Avenue (tile -1_5 #106)', lat: 40.755978, lon: -73.975968, landmarkId: 77 },
  );
  // the colours (and a curtain wall's style) of the towers the kit dresses from facts the records lack (city/tk/tkOverrides.js)
  if (!q || (q.get('twlm') !== '0')) {
    for (const t of TW_TOWERS) if (t.color || t.style) BUILDING_OVERRIDES.push({ key: 'tw:' + t.key, name: t.name, lat: t.lat, lon: t.lon, ...(t.color ? { color: t.color } : {}), ...(t.style ? { style: t.style } : {}) });
  }
}
// /TW
// LM16 (landmarks round, 2026-10-16): the Metropolitan Museum's compiled footprint (one 63-sided ring at 26.8 m, landmark id
// -44, decorate) becomes a replace landmark on the tiles already built: city/lmMetMuseum.js draws its walls and roofs, so the
// extrusion goes. The point is its LANDMARKS entry's (inside the ring, about 50 m in from the Fifth Avenue front). `?met16=0` keeps
// the decorate builder on the extrusion.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('met16') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm16Met', name: 'The Metropolitan Museum of Art (city/lmMetMuseum.js)', lat: 40.77940, lon: -73.96320, landmarkId: 44 },
  );
}
// /LM16
// LM66 (2026-10-31): Hudson Yards on the tiles already built (the ids of the LANDMARKS entries above, the same points; 100-107 since the downtown set took 82-93). The
// footprint dataset gives 10 Hudson Yards (tile -5_6 #17) the 45.4 m of its podium and 55 Hudson Yards (tile -6_6 #51) 24.4 m;
// the towers rise to 273 m and 237 m. `?lm66=0` keeps the compiled records.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lm66') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm66Hy10', name: '10 Hudson Yards (tile -5_6 #17)', lat: 40.752763, lon: -74.001565, landmarkId: 100, height: 273 },
    { key: 'lm66Hy35', name: '35 Hudson Yards (tile -6_6 #18)', lat: 40.754640, lon: -74.002261, landmarkId: 101 },
    { key: 'lm66Hy15', name: '15 Hudson Yards and The Shed (tile -6_6 #28)', lat: 40.753407, lon: -74.002880, landmarkId: 102 },
    { key: 'lm66Hy50', name: '50 Hudson Yards (tile -5_6 #31)', lat: 40.754529, lon: -74.000108, landmarkId: 103 },
    { key: 'lm66Hy55', name: '55 Hudson Yards (tile -6_6 #51)', lat: 40.755171, lon: -74.001740, landmarkId: 104, height: 237.4 },
    { key: 'lm66Spiral', name: 'The Spiral (tile -5_6 #59)', lat: 40.755278, lon: -73.999489, landmarkId: 105 },
    { key: 'lm66Vessel', name: 'The Vessel (tile -6_6 #36)', lat: 40.753855, lon: -74.002236, landmarkId: 106 },
    { key: 'lm66VesselSliver', name: 'the sliver inside the Vessel\'s ring (tile -6_6 #38)', lat: 40.753676, lon: -74.002163, landmarkId: 107 },
  );
  // UN67: the UN complex's one compiled prism (tile 0_7 #4, 21.6 m) to its builder
  if (!q || q.get('un67') !== '0') BUILDING_OVERRIDES.push(
    { key: 'un67Campus', name: 'UN General Assembly and Conference Buildings (tile 0_7 #4)', lat: 40.750092, lon: -73.967714, landmarkId: 108 },
  );
}
// /LM66
// LM64 (2026-10-30): the MetLife Building and the Helmsley Building on the tiles already built. The footprint dataset gives the
// MetLife footprint (tile -1_6 #18) the height of its base, 47.9 m (157 ft); the tower's roof is 241.7 m over the street in
// the city's 3D building model, 246 m to its parapet. Id 25 had fallen on the Helmsley Building (#32), which takes its own
// id 81. `?lm64=0` keeps the compiled records.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lm64') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm64MetLife', name: 'MetLife Building, 200 Park Avenue (tile -1_6 #18)', lat: 40.753556, lon: -73.976626, landmarkId: 25, height: 246, clear: ['WATERTOWER', 'SETBACKS'] },
    { key: 'lm64Helmsley', name: 'Helmsley Building, 230 Park Avenue (tile -1_6 #32), which id 25 had replaced', lat: 40.754399, lon: -73.976102, landmarkId: 81, clear: ['WATERTOWER', 'SETBACKS'] },
  );
}
// /LM64
// LM65 (2026-10-31): lower Manhattan's landmarks on the tiles already built. Id 51 (40 Wall Street) had fallen on a 22 m building
// at Pine and William Streets (tile -7_16 #23) and the tower (#47) drew as a generic 246 m extrusion; id 41 (56 Leonard) on a
// 10.8 m shop row (tile -6_14 #100), and the tower's own footprint (#135) carries the footprint dataset's 77.7 m (255 ft) where
// the tower rises to 250 m (821 ft). `?lm65=0` keeps the compiled records.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('lm65') !== '0') BUILDING_OVERRIDES.push(
    { key: 'lm65W40', name: '40 Wall Street (tile -7_16 #47)', lat: 40.706963, lon: -74.009672, landmarkId: 51, clear: ['WATERTOWER', 'SETBACKS'] },
    { key: 'lm65NotW40', name: 'the 22 m building at Pine and William Streets id 51 had replaced (tile -7_16 #23)', lat: 40.706968, lon: -74.008725, landmarkId: 0 },
    { key: 'lm65Leonard', name: '56 Leonard Street (tile -6_14 #135)', lat: 40.717663, lon: -74.006322, landmarkId: 41, height: 250, clear: ['WATERTOWER', 'SETBACKS'] },
    { key: 'lm65NotLeonard', name: 'the shop row id 41 had replaced (tile -6_14 #100)', lat: 40.717803, lon: -74.004855, landmarkId: 0 },
    { key: 'lm65Oculus', name: 'World Trade Center Transportation Hub (tile -7_15 #36)', lat: 40.711522, lon: -74.011407, landmarkId: 82, clear: ['WATERTOWER', 'SETBACKS'] },
    ...[[83, 40.71055, -74.015588], [84, 40.712487, -74.015414], [85, 40.713576, -74.014842], [86, 40.714058, -74.015912], [87, 40.713081, -74.015372], [88, 40.707667, -74.010757],
      [89, 40.70097, -74.013039], [90, 40.701086, -74.011647], [91, 40.711311, -74.009164],
      [92, 40.703447, -74.016813], [93, 40.704462, -74.017478]]
      .map(([id, lat, lon]) => ({ key: 'lm65_' + id, name: LANDMARKS.find((l) => l.id === id).name, lat, lon, landmarkId: id, clear: ['WATERTOWER', 'SETBACKS'] })),
  );
}
// /LM65
// BP69 (2026-11-02): four towers east of the Battery the compile classed as glass curtain walls (style 3) on a blue-grey
// tint; they are clad in aluminium, precast concrete and stone with punched or ribbon windows, and the path traced
// dioramas drew their shaded faces black. Colours sampled off their sunlit faces. `?bp69=0` keeps the compiled records.
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!q || q.get('bp69') !== '0') BUILDING_OVERRIDES.push(
    { key: 'bp69OneNyPlaza', name: 'One New York Plaza (1969): silver aluminium, a grid of small recessed windows (tile -7_17 #57)', lat: 40.702042, lon: -74.011952,
      style: 'PREWAR_APT', color: [178, 180, 180], winW: 1.5, clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'SETBACKS'] },
    { key: 'bp69Broad125', name: '125 Broad Street: pale piers, dark glass between (tile -7_17 #16)', lat: 40.702362, lon: -74.01049,
      style: 'DECO_MASONRY', color: [212, 212, 208], clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'SETBACKS'] },
    { key: 'bp69Broad85', name: '85 Broad Street (1983): red-brown precast panels, ribbon windows (tile -7_17 #69)', lat: 40.704012, lon: -74.011144,
      style: 'POSTWAR_BRICK', color: [146, 82, 66], clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'SETBACKS'] },
    { key: 'bp69Water55', name: '55 Water Street (1972): dark glass between pale vertical piers (tile -7_17 #60)', lat: 40.703236, lon: -74.008945,
      style: 'DECO_MASONRY', color: [112, 114, 120], clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'SETBACKS'] },
    // the gap-fill's canopies (building=roof: a roof on posts) drawn as solid blocks in the plazas and the park, and the block
    // on the East River esplanade under the FDR Drive's ramp up to the viaduct, which the ramp itself replaces
    { key: 'bp69CanopyBroad', name: 'canopy on the plaza at Broad and South Streets (tile -7_17 #81)', lat: 40.702407, lon: -74.01103, drop: true },
    { key: 'bp69CanopyBattery', name: 'canopy in the Battery by State Street (tile -8_17 #17, 12 m)', lat: 40.702308, lon: -74.014174, drop: true },
    { key: 'bp69CanopyBridge', name: 'canopy at Bridge and Whitehall Streets (tile -7_17 #78)', lat: 40.704637, lon: -74.013532, drop: true },
    { key: 'bp69CanopyWest', name: 'canopy by West Street (tile -8_16 #41)', lat: 40.70631, lon: -74.016912, drop: true },
    { key: 'bp69FdrRamp', name: 'the block under the FDR Drive ramp at Old Slip (tile -7_17 #73)', lat: 40.702903, lon: -74.008164, drop: true },
    // untagged small structures the gap-fill gave its 12 m default
    { key: 'bp69VietnamWall', name: 'New York Vietnam Veterans Memorial (1985): the green glass block wall, 4.9 m (tile -7_17 #75)', lat: 40.702676, lon: -74.009788,
      style: 'CIVIC_STONE', color: [126, 160, 146], height: 4.9, storeH: 0, clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'STOREFRONT'] },
    { key: 'bp69BatteryShed', name: 'one-storey park building in the Battery (tile -8_17 #20)', lat: 40.703703, lon: -74.01605,
      style: 'CIVIC_STONE', color: [206, 202, 192], height: 3.6, storeH: 0, clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'STOREFRONT'] },
    { key: 'bp69BatteryShore', name: 'one-storey building on the Battery\'s east shore (tile -8_17 #15)', lat: 40.701033, lon: -74.013914,
      style: 'CIVIC_STONE', color: [214, 212, 204], height: 5, storeH: 0, clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'STOREFRONT'] },
    { key: 'bp69BroadPavilion', name: 'the low pale pavilion on the plaza at Broad and South Streets (tile -7_17 #80)', lat: 40.702167, lon: -74.011085,
      style: 'CIVIC_STONE', color: [208, 208, 204], storeH: 0, clear: ['CORNICE', 'WATERTOWER', 'FIRE_ESCAPE', 'STOREFRONT'] },
  );
}
// /BP69
