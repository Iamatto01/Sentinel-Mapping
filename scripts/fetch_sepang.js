/**
 * Skrip ini akan menyedut data semua bangunan di daerah Sepang dari OpenStreetMap (Overpass API).
 * Pastikan anda mempunyai sambungan internet yang stabil.
 * 
 * Cara guna:
 * 1. Buka terminal
 * 2. Jalankan: node scripts/fetch_sepang.js
 */

const fs = require('fs');
const path = require('path');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query Overpass QL untuk daerah Sepang
// Kita mencari relation boundary untuk Sepang, kemudian cari bangunan di dalamnya.
const query = `
[out:json][timeout:300];
area["name"="Sepang"]["admin_level"="6"]->.searchArea;
(
  way["building"](area.searchArea);
  relation["building"](area.searchArea);
);
out body;
>;
out skel qt;
`;

async function fetchSepangBuildings() {
  console.log('⏳ Mula menyedut ratusan ribu bangunan di Sepang dari pelayan OpenStreetMap...');
  console.log('Sila tunggu. Ini mungkin mengambil masa beberapa minit kerana saiz data yang besar.');

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SentinalMappingApp/1.0 (muham@example.com)'
      },
      body: 'data=' + encodeURIComponent(query)
    });

    if (!response.ok) {
      throw new Error(`Ralat Pelayan: ${response.status} ${response.statusText}`);
    }

    console.log('✅ Berjaya menerima data! Sedang menyimpan ke dalam fail...');
    
    // Tulis data JSON mentah
    const textData = await response.text();
    const outPath = path.join(__dirname, '..', 'data', 'sepang_osm_raw.json');
    
    // Buat folder data jika belum wujud
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }

    fs.writeFileSync(outPath, textData, 'utf8');
    
    console.log(`🎉 Selesai! Data telah disimpan di: ${outPath}`);
    console.log('');
    console.log('Langkah seterusnya:');
    console.log('1. Tukar fail sepang_osm_raw.json kepada GeoJSON menggunakan osmtogeojson.');
    console.log('   (Boleh pasang melalui npm: npm install -g osmtogeojson)');
    console.log('   Arahan: osmtogeojson data/sepang_osm_raw.json > data/sepang_buildings.geojson');
    console.log('2. Tukar fail GeoJSON tersebut kepada PMTiles menggunakan Tippecanoe atau pmtiles CLI.');
    console.log('   Simpan hasil akhirnya sebagai data/buildings.pmtiles');
    
  } catch (err) {
    console.error('❌ Ralat berlaku semasa menarik data:', err.message);
  }
}

fetchSepangBuildings();
