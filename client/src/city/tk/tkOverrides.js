// Tower kit (TW): the facts of the towers in the Central Park South and Midtown frames that the records do not carry (the
// facade's material and colour, the glass), on towers whose compiled massing stands. Each entry is a point inside the
// compiled footprint (the census: tile and index in the comment). The colour and style go to the tile at read time with the
// other building overrides (shared/landmarkSpec.js), so the facade shader draws the same tower beyond the kit's radius;
// the facade parameters `P` go to the tower kit (world/towerKit.js) over the ones it derives from the records.
import { LM_GLASS } from './tkParams.js';

const { BLACKG, BRONZEK } = LM_GLASS;
export const TW_TOWERS = [
  { key: 'essexHouse', name: 'Essex House, 160 Central Park South (1931): buff brick, Art Deco piers', lat: 40.766180, lon: -73.978513, color: [186, 160, 132],
    P: { arch: 'deco', wallSet: 'brick_tan', hex: '#bba085', trimSet: 'cast_stone', piers: true } },   // -2_3:37
  { key: 'hampshireHouse', name: 'Hampshire House, 150 Central Park South (1937): pale brick', lat: 40.766061, lon: -73.977898, color: [222, 216, 204],
    P: { arch: 'masonry', wallSet: 'brick_white_glazed', hex: '#ddd7cb', trimSet: 'stone_lime', cornice: 0, fpCornice: 0 } },   // -2_3:50
  { key: 'parkLane', name: 'Park Lane Hotel, 36 Central Park South (1971): white brick slab', lat: 40.764861, lon: -73.975382, color: [222, 218, 208],
    P: { arch: 'slab', wallSet: 'brick_white_glazed', hex: '#dedad0', finish: 'alu_clear' } },   // -1_3:15
  { key: 'trumpParc', name: '112 Central Park South (1930): tan brick', lat: 40.765721, lon: -73.977057, color: [196, 160, 124],
    P: { arch: 'deco', wallSet: 'brick_tan', hex: '#c4a07c' } },   // -1_3:33
  { key: 'metTower', name: 'Metropolitan Tower, 146 W 57th St (1987): black glass', lat: 40.764767, lon: -73.979201, color: [40, 42, 46], style: 'MODERN_GLASS',
    P: { arch: 'cwGrid', famObj: BLACKG, finish: 'alu_black', spandrelHex: '#121315', mullD: 0.12 } },   // -2_3:51
  { key: 'carnegieTower', name: 'Carnegie Hall Tower, 152 W 57th St (1991): brick in two reds', lat: 40.764778, lon: -73.979625, color: [150, 88, 66],
    P: { arch: 'pm', wallSet: 'brick_red', hex: '#9a5a44', trimSet: 'cast_stone', belts: true } },   // -2_3:69
  { key: 'citySpire', name: 'CitySpire, 150 W 56th St (1987): tan stone and glass', lat: 40.764190, lon: -73.979520, color: [204, 186, 158],
    P: { arch: 'pm', wallSet: 'stone_lime_ashlar', hex: '#ccb99c', trimSet: 'stone_lime' } },   // -2_4:11
  { key: 'cpw15', name: '15 Central Park West (2008): limestone', lat: 40.770040, lon: -73.981744, color: [216, 206, 186],
    P: { arch: 'pm', wallSet: 'stone_lime_ashlar', hex: '#d8ceb9', trimSet: 'stone_lime', belts: true } },   // -2_2:58
  { key: 'cpw15house', name: '15 Central Park West, the house on the park (2008): limestone', lat: 40.769689, lon: -73.981013, color: [216, 206, 186],
    P: { arch: 'pm', wallSet: 'stone_lime_ashlar', hex: '#d8ceb9', trimSet: 'stone_lime', belts: true } },   // -2_2:50
  { key: 'plaza', name: 'The Plaza (1907): white glazed brick and marble', lat: 40.764387, lon: -73.974546,
    P: { arch: 'masonry', wallSet: 'brick_white_glazed', hex: '#ebe7de', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', cornice: 1, belts: true } },   // -1_4:130
  { key: 'solow', name: '9 West 57th St (1974): black glass between travertine piers', lat: 40.763881, lon: -73.975007, color: [60, 62, 66], style: 'MODERN_GLASS',
    P: { arch: 'cwPier', famObj: BLACKG, finish: 'alu_black', pierSet: 'stone_lime', pierW: 0.72, pierD: 0.42, spandrelHex: '#141517' } },   // -1_4:70
  { key: 'trumpTower', name: 'Trump Tower, 725 Fifth Ave (1983): dark bronze glass', lat: 40.762343, lon: -73.973816, color: [52, 44, 38], style: 'MODERN_GLASS',
    P: { arch: 'cwGrid', famObj: BRONZEK, finish: 'alu_bronze', spandrelHex: '#2a221c', mullD: 0.1 } },   // -1_4:113
  { key: 'cps240', name: '240 Central Park South (1940): red brick', lat: 40.767312, lon: -73.981272, color: [160, 98, 74],
    P: { arch: 'masonry', wallSet: 'brick_red', hex: '#a0624a' } },   // -2_3:27
  { key: 'cps200', name: '200 Central Park South (1963): white brick', lat: 40.766777, lon: -73.979680, color: [220, 214, 202],
    P: { arch: 'slab', wallSet: 'brick_white_glazed', hex: '#dcd6ca' } },   // -2_3:77
];
