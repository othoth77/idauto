'use strict';
// IDauto — Update 3 — Tunisia: governorates, delegations, and an OFFLINE answer to
// "which governorate is this point in, and what known place is it near?".
//
// No network: coordinates never leave this server to be resolved. The price is precision.
// resolve() names the nearest KNOWN place (a few dozen towns listed below, positions rounded to about a
// kilometre) and the governorate of that place; far from any listed place it falls back to the nearest
// governorate centre. Both are approximations and are returned as such (`approximate: true`): the person
// can correct the place, and the ORIGINAL coordinates are always what is stored.
//
// The delegation lists are there for manual entry (suggestions; free text is always accepted). They were
// compiled from memory and should be checked against the official list before being relied upon.

var BOUNDS = { latMin: 30.2, latMax: 37.6, lonMin: 7.5, lonMax: 11.7 };

// [name, centre latitude, centre longitude, delegations…]
var GOVERNORATES = [
  ['Tunis', 36.80, 10.18, 'Tunis Médina', 'Bab El Bhar', 'Bab Souika', 'El Omrane', 'El Omrane Supérieur', 'Ettahrir', 'El Menzah', 'Cité El Khadra', 'Le Bardo', 'Séjoumi', 'Ezzouhour', 'El Hrairia', 'Sidi Hassine', 'El Ouardia', 'El Kabaria', 'Sidi El Béchir', 'Djebel Jelloud', 'La Goulette', 'Le Kram', 'Carthage', 'La Marsa'],
  ['Ariana', 36.95, 10.15, 'Ariana Ville', 'Ettadhamen', 'Mnihla', 'Kalâat el-Andalous', 'Raoued', 'Sidi Thabet', 'La Soukra'],
  ['Ben Arous', 36.65, 10.23, 'Ben Arous', 'Bou Mhel el-Bassatine', 'El Mourouj', 'Ezzahra', 'Fouchana', 'Hammam Chott', 'Hammam Lif', 'Khelidia', 'Mégrine', 'Mohamedia', 'Mornag', 'Nouvelle Médina', 'Radès'],
  ['Manouba', 36.81, 9.86, 'La Manouba', 'Borj El Amri', 'Djedeida', 'Douar Hicher', 'El Battan', 'Mornaguia', 'Oued Ellil', 'Tebourba'],
  ['Nabeul', 36.60, 10.70, 'Nabeul', 'Béni Khalled', 'Béni Khiar', 'Bou Argoub', 'Dar Chaâbane El Fehri', 'El Haouaria', 'El Mida', 'Grombalia', 'Hammam Ghezèze', 'Hammamet', 'Kélibia', 'Korba', 'Menzel Bouzelfa', 'Menzel Temime', 'Soliman', 'Takelsa'],
  ['Zaghouan', 36.35, 10.05, 'Zaghouan', 'Bir Mcherga', 'El Fahs', 'Nadhour', 'Saouaf', 'Zriba'],
  ['Bizerte', 37.10, 9.70, 'Bizerte Nord', 'Bizerte Sud', 'El Alia', 'Ghar El Melh', 'Ghezala', 'Joumine', 'Mateur', 'Menzel Bourguiba', 'Menzel Jemil', 'Ras Jebel', 'Sejnane', 'Tinja', 'Utique', 'Zarzouna'],
  ['Béja', 36.75, 9.20, 'Béja Nord', 'Béja Sud', 'Amdoun', 'Goubellat', 'Medjez el-Bab', 'Nefza', 'Téboursouk', 'Testour', 'Thibar'],
  ['Jendouba', 36.60, 8.75, 'Jendouba', 'Jendouba Nord', 'Aïn Draham', 'Balta-Bou Aouane', 'Bou Salem', 'Fernana', 'Ghardimaou', 'Oued Meliz', 'Tabarka'],
  ['Le Kef', 36.10, 8.75, 'Le Kef Est', 'Le Kef Ouest', 'Dahmani', 'Djérissa', 'El Ksour', 'Kalâat Khasba', 'Kalaat Senan', 'Nebeur', 'Sakiet Sidi Youssef', 'Sers', 'Tajerouine'],
  ['Siliana', 36.00, 9.40, 'Siliana Nord', 'Siliana Sud', 'Bargou', 'Bou Arada', 'El Aroussa', 'El Krib', 'Gaâfour', 'Kesra', 'Makthar', 'Rouhia', 'Sidi Bou Rouis'],
  ['Sousse', 35.85, 10.50, 'Sousse Médina', 'Sousse Riadh', 'Sousse Jawhara', 'Sousse Sidi Abdelhamid', 'Akouda', 'Bouficha', 'Enfida', 'Hammam Sousse', 'Hergla', 'Kalâa Kebira', 'Kalâa Seghira', 'Kondar', 'Msaken', 'Sidi Bou Ali', 'Sidi El Hani'],
  ['Monastir', 35.65, 10.80, 'Monastir', 'Bekalta', 'Bembla', 'Beni Hassen', 'Jemmal', 'Ksar Hellal', 'Ksibet el-Médiouni', 'Moknine', 'Ouerdanine', 'Sahline', 'Sayada-Lamta-Bou Hajar', 'Téboulba', 'Zéramdine'],
  ['Mahdia', 35.35, 10.75, 'Mahdia', 'Bou Merdes', 'Chebba', 'Chorbane', 'El Jem', 'Essouassi', 'Hebira', 'Ksour Essef', 'Melloulèche', 'Ouled Chamekh', 'Sidi Alouane'],
  ['Sfax', 34.80, 10.40, 'Sfax Ville', 'Sfax Ouest', 'Sfax Sud', 'Agareb', 'Bir Ali Ben Khalifa', 'El Amra', 'El Hencha', 'Ghraïba', 'Jebiniana', 'Kerkennah', 'Mahrès', 'Menzel Chaker', 'Sakiet Eddaïer', 'Sakiet Ezzit', 'Skhira', 'Thyna'],
  ['Kairouan', 35.60, 9.90, 'Kairouan Nord', 'Kairouan Sud', 'Bou Hajla', 'Chebika', 'Echrarda', 'El Alâa', 'Haffouz', 'Hajeb El Ayoun', 'Nasrallah', 'Oueslatia', 'Sbikha'],
  ['Kasserine', 35.20, 8.70, 'Kasserine Nord', 'Kasserine Sud', 'El Ayoun', 'Ezzouhour', 'Fériana', 'Foussana', 'Haïdra', 'Hassi El Ferid', 'Jedelienne', 'Majel Bel Abbès', 'Sbeïtla', 'Sbiba', 'Thala'],
  ['Sidi Bouzid', 34.90, 9.50, 'Sidi Bouzid Est', 'Sidi Bouzid Ouest', 'Bir El Hafey', 'Cebbala Ouled Asker', 'Jilma', 'Meknassy', 'Menzel Bouzaiane', 'Mezzouna', 'Ouled Haffouz', 'Regueb', 'Sidi Ali Ben Aoun', 'Souk Jedid'],
  ['Gabès', 33.80, 9.80, 'Gabès Médina', 'Gabès Ouest', 'Gabès Sud', 'El Hamma', 'Ghannouch', 'Mareth', 'Matmata', 'Nouvelle Matmata', 'Menzel El Habib', 'Métouia'],
  ['Médenine', 33.30, 10.90, 'Médenine Nord', 'Médenine Sud', 'Ben Gardane', 'Beni Khedache', 'Djerba Ajim', 'Djerba Houmt Souk', 'Djerba Midoun', 'Sidi Makhlouf', 'Zarzis'],
  ['Tataouine', 32.00, 10.00, 'Tataouine Nord', 'Tataouine Sud', 'Bir Lahmar', 'Dehiba', 'Ghomrassen', 'Remada', 'Smâr'],
  ['Gafsa', 34.40, 8.90, 'Gafsa Nord', 'Gafsa Sud', 'Belkhir', 'El Guettar', 'El Ksar', 'Mdhilla', 'Métlaoui', 'Moularès', 'Redeyef', 'Sened', 'Sidi Aïch'],
  ['Tozeur', 33.95, 8.00, 'Tozeur', 'Degache', 'Hazoua', 'Nefta', 'Tameghza'],
  ['Kébili', 33.40, 8.80, 'Kébili Nord', 'Kébili Sud', 'Douz Nord', 'Douz Sud', 'Faouar', 'Souk Lahad']
];

// Known places: [name, governorate, latitude, longitude] — positions rounded, good to about a kilometre.
var PLACES = [
  ['Tunis', 'Tunis', 36.806, 10.181], ['Le Bardo', 'Tunis', 36.809, 10.141], ['La Marsa', 'Tunis', 36.878, 10.325], ['Carthage', 'Tunis', 36.853, 10.323], ['La Goulette', 'Tunis', 36.818, 10.305], ['Le Kram', 'Tunis', 36.833, 10.317], ['Sidi Hassine', 'Tunis', 36.76, 10.10], ['El Menzah', 'Tunis', 36.84, 10.18],
  ['Ariana', 'Ariana', 36.862, 10.195], ['La Soukra', 'Ariana', 36.875, 10.25], ['Raoued', 'Ariana', 36.94, 10.19], ['Ettadhamen', 'Ariana', 36.84, 10.10], ['Sidi Thabet', 'Ariana', 36.91, 10.04], ['Kalâat el-Andalous', 'Ariana', 37.06, 10.12],
  ['Ben Arous', 'Ben Arous', 36.753, 10.219], ['Radès', 'Ben Arous', 36.768, 10.275], ['Ezzahra', 'Ben Arous', 36.744, 10.308], ['Hammam Lif', 'Ben Arous', 36.727, 10.342], ['Mégrine', 'Ben Arous', 36.769, 10.233], ['El Mourouj', 'Ben Arous', 36.72, 10.21], ['Fouchana', 'Ben Arous', 36.70, 10.17], ['Mohamedia', 'Ben Arous', 36.675, 10.156], ['Khelidia', 'Ben Arous', 36.646, 10.196], ['Mornag', 'Ben Arous', 36.68, 10.29], ['Bou Mhel el-Bassatine', 'Ben Arous', 36.73, 10.30],
  ['La Manouba', 'Manouba', 36.808, 10.097], ['Douar Hicher', 'Manouba', 36.83, 10.08], ['Oued Ellil', 'Manouba', 36.83, 10.04], ['Mornaguia', 'Manouba', 36.76, 10.01], ['Tebourba', 'Manouba', 36.83, 9.84], ['Djedeida', 'Manouba', 36.85, 9.93], ['Borj El Amri', 'Manouba', 36.71, 9.88],
  ['Nabeul', 'Nabeul', 36.456, 10.735], ['Hammamet', 'Nabeul', 36.400, 10.616], ['Grombalia', 'Nabeul', 36.60, 10.50], ['Soliman', 'Nabeul', 36.70, 10.49], ['Kélibia', 'Nabeul', 36.847, 11.094], ['Korba', 'Nabeul', 36.578, 10.858], ['Menzel Temime', 'Nabeul', 36.78, 10.99], ['Menzel Bouzelfa', 'Nabeul', 36.68, 10.58],
  ['Zaghouan', 'Zaghouan', 36.403, 10.143], ['El Fahs', 'Zaghouan', 36.37, 9.90],
  ['Bizerte', 'Bizerte', 37.274, 9.874], ['Menzel Bourguiba', 'Bizerte', 37.154, 9.785], ['Mateur', 'Bizerte', 37.04, 9.665], ['Ras Jebel', 'Bizerte', 37.215, 10.12],
  ['Béja', 'Béja', 36.726, 9.182], ['Medjez el-Bab', 'Béja', 36.65, 9.61], ['Testour', 'Béja', 36.55, 9.44],
  ['Jendouba', 'Jendouba', 36.501, 8.780], ['Tabarka', 'Jendouba', 36.954, 8.758], ['Aïn Draham', 'Jendouba', 36.78, 8.69], ['Bou Salem', 'Jendouba', 36.61, 8.97],
  ['Le Kef', 'Le Kef', 36.174, 8.705], ['Dahmani', 'Le Kef', 35.94, 8.83], ['Tajerouine', 'Le Kef', 35.89, 8.55],
  ['Siliana', 'Siliana', 36.085, 9.371], ['Makthar', 'Siliana', 35.86, 9.20], ['Bou Arada', 'Siliana', 36.35, 9.62],
  ['Sousse', 'Sousse', 35.826, 10.637], ['Hammam Sousse', 'Sousse', 35.86, 10.60], ['Msaken', 'Sousse', 35.73, 10.58], ['Enfida', 'Sousse', 36.13, 10.38], ['Kalâa Kebira', 'Sousse', 35.87, 10.53], ['Akouda', 'Sousse', 35.87, 10.57],
  ['Monastir', 'Monastir', 35.778, 10.826], ['Moknine', 'Monastir', 35.63, 10.90], ['Ksar Hellal', 'Monastir', 35.65, 10.89], ['Jemmal', 'Monastir', 35.62, 10.76], ['Sahline', 'Monastir', 35.75, 10.71],
  ['Mahdia', 'Mahdia', 35.505, 11.062], ['El Jem', 'Mahdia', 35.30, 10.71], ['Ksour Essef', 'Mahdia', 35.42, 10.99], ['Chebba', 'Mahdia', 35.24, 11.11],
  ['Sfax', 'Sfax', 34.740, 10.760], ['Sakiet Ezzit', 'Sfax', 34.80, 10.76], ['Sakiet Eddaïer', 'Sfax', 34.80, 10.78], ['Mahrès', 'Sfax', 34.53, 10.50], ['Jebiniana', 'Sfax', 35.03, 10.91], ['Skhira', 'Sfax', 34.30, 10.07],
  ['Kairouan', 'Kairouan', 35.678, 10.096], ['Haffouz', 'Kairouan', 35.63, 9.67], ['Sbikha', 'Kairouan', 35.93, 10.02],
  ['Kasserine', 'Kasserine', 35.168, 8.836], ['Sbeïtla', 'Kasserine', 35.23, 9.12], ['Fériana', 'Kasserine', 34.95, 8.57], ['Thala', 'Kasserine', 35.57, 8.67],
  ['Sidi Bouzid', 'Sidi Bouzid', 35.038, 9.485], ['Regueb', 'Sidi Bouzid', 34.86, 9.79], ['Meknassy', 'Sidi Bouzid', 34.61, 9.61],
  ['Gabès', 'Gabès', 33.881, 10.098], ['El Hamma', 'Gabès', 33.89, 9.80], ['Mareth', 'Gabès', 33.63, 10.29], ['Matmata', 'Gabès', 33.54, 9.97],
  ['Médenine', 'Médenine', 33.355, 10.505], ['Houmt Souk', 'Médenine', 33.876, 10.858], ['Midoun', 'Médenine', 33.81, 11.00], ['Zarzis', 'Médenine', 33.504, 11.112], ['Ben Gardane', 'Médenine', 33.138, 11.220],
  ['Tataouine', 'Tataouine', 32.930, 10.452], ['Ghomrassen', 'Tataouine', 33.06, 10.34], ['Remada', 'Tataouine', 32.32, 10.40],
  ['Gafsa', 'Gafsa', 34.425, 8.784], ['Métlaoui', 'Gafsa', 34.32, 8.40], ['Redeyef', 'Gafsa', 34.38, 8.15],
  ['Tozeur', 'Tozeur', 33.920, 8.134], ['Nefta', 'Tozeur', 33.87, 7.88],
  ['Kébili', 'Kébili', 33.705, 8.969], ['Douz', 'Kébili', 33.46, 9.02]
];

var NEAR_KM = 12;       // a place is named only when the point is this close to it

function km(lat1, lon1, lat2, lon2) {
  var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function validCoords(lat, lon) { return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0); }
function inTunisia(lat, lon) { return lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax; }

// resolve(lat, lon) → { place_name, governorate, country, approximate, distance_km } — every name may be null.
function resolve(lat, lon) {
  if (!validCoords(lat, lon)) return null;
  if (!inTunisia(lat, lon)) return { place_name: null, governorate: null, country: null, approximate: true, distance_km: null, outside: true };
  var best = null, i;
  for (i = 0; i < PLACES.length; i++) { var d = km(lat, lon, PLACES[i][2], PLACES[i][3]); if (!best || d < best.d) best = { d: d, p: PLACES[i] }; }
  if (best && best.d <= NEAR_KM) return { place_name: best.p[0], governorate: best.p[1], country: 'Tunisie', approximate: true, distance_km: Math.round(best.d * 10) / 10 };
  var g = null;
  for (i = 0; i < GOVERNORATES.length; i++) { var dg = km(lat, lon, GOVERNORATES[i][1], GOVERNORATES[i][2]); if (!g || dg < g.d) g = { d: dg, name: GOVERNORATES[i][0] }; }
  return { place_name: null, governorate: g.name, country: 'Tunisie', approximate: true, distance_km: Math.round(g.d * 10) / 10 };
}

function governorates() { return GOVERNORATES.map(function (g) { return { name: g[0], delegations: g.slice(3) }; }); }
function governorateOf(name) {
  var n = String(name || '').trim().toLowerCase();
  for (var i = 0; i < GOVERNORATES.length; i++) if (GOVERNORATES[i][0].toLowerCase() === n) return GOVERNORATES[i][0];
  return null;
}

module.exports = { resolve: resolve, governorates: governorates, governorateOf: governorateOf, validCoords: validCoords, inTunisia: inTunisia, km: km, NEAR_KM: NEAR_KM, PLACES: PLACES };
