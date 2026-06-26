/**
 * polygonMap.js — Polygon / Lot Map Module (Feature B)
 * Queries the Overpass API for building footprints within a named Taman,
 * converts to GeoJSON, renders polygons, and auto-matches resident data.
 */

const PolygonMap = (() => {
  const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

  /** @type {L.GeoJSON|null} */
  let polygonLayer = null;

  /** @type {Map<string, {feature: Object, residents: Array}>} */
  const matchedPolygons = new Map();

  /** @type {number} */
  let lastMatchedCount = 0;

  /**
   * Search for a Taman/location using ArcGIS Geocoder, fly to it, and fetch OSM buildings.
   * @param {string} query
   * @param {L.Map} map
   * @param {Array} residents
   */
  async function searchTaman(query, map, residents) {
    if (!query || !map) return { total: 0, matched: 0 };

    UI.setTamanSearchLoading(true);
    UI.showToast(`Mencari "${query}"...`, 'info', 3000);

    try {
      const searchQuery = query.toLowerCase().includes('malaysia') ? query : `${query}, Malaysia`;
      const geocodeUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(searchQuery)}&outSR=4326&maxLocations=1`;
      
      const geoRes = await fetch(geocodeUrl);
      const geoData = await geoRes.json();

      if (!geoData.candidates || geoData.candidates.length === 0) {
        UI.showToast(`Lokasi "${query}" tidak dijumpai.`, 'error');
        UI.setTamanSearchLoading(false);
        return { total: 0, matched: 0 };
      }

      const bestMatch = geoData.candidates[0];
      const extent = bestMatch.extent;
      
      if (!extent) {
        UI.showToast(`Gagal mendapatkan saiz kawasan untuk "${query}".`, 'error');
        UI.setTamanSearchLoading(false);
        return { total: 0, matched: 0 };
      }

      const south = extent.ymin;
      const west = extent.xmin;
      const north = extent.ymax;
      const east = extent.xmax;

      map.fitBounds([[south, west], [north, east]]);

      // Step 1: Build Overpass query using bounding box
      const overpassQuery = buildOverpassQuery(null, [south, west, north, east]);
      console.log('[PolygonMap] Overpass query:', overpassQuery);

      // Step 2: Fetch from Overpass API
      const osmData = await fetchOverpass(overpassQuery);

      if (!osmData || !osmData.elements || osmData.elements.length === 0) {
        UI.showToast(`Tiada bangunan ditemui untuk "${query}".`, 'error', 5000);
        UI.setTamanSearchLoading(false);
        return { total: 0, matched: 0 };
      }

      console.log(`[PolygonMap] Overpass returned ${osmData.elements.length} elements.`);

      // Step 3: Convert OSM JSON to GeoJSON using osmtogeojson
      const geojson = osmtogeojson(osmData);
      console.log(`[PolygonMap] Converted to ${geojson.features.length} GeoJSON features.`);

      // Step 4: Run auto-match logic
      const matchResult = matchResidents(geojson, residents, query);

      // Step 5: Render polygons on map
      renderPolygons(map, geojson, matchResult.lookup);

      UI.setTamanSearchLoading(false);
      UI.showToast(`Berjaya menarik ${geojson.features.length} bangunan!`, 'success');
      
      return {
        total: geojson.features.length,
        matched: matchResult.matchedCount
      };
    } catch (err) {
      console.error('[PolygonMap] Error:', err);
      UI.setTamanSearchLoading(false);
      UI.showToast(`Ralat semasa mencari: ${err.message}`, 'error', 5000);
      return { total: 0, matched: 0 };
    }
  }

  /**
   * Build an Overpass QL query for buildings.
   * If bbox is provided, it does a very fast bounding box search.
   * Otherwise, it falls back to a regex area name search.
   * @param {string} areaName
   * @param {Array|null} bbox - [south, west, north, east]
   * @returns {string}
   */
  function buildOverpassQuery(areaName, bbox) {
    if (bbox && bbox.length === 4) {
      // Ultra-fast bounding box query
      const [s, w, n, e] = bbox;
      return `
        [out:json][timeout:25];
        (
          way["building"](${s},${w},${n},${e});
          relation["building"](${s},${w},${n},${e});
        );
        out geom;
      `;
    }

    // Escape special characters for Overpass regex
    const escaped = areaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Restrict search bounds to Malaysia (approx 0.8 to 7.3 Lat, 99.5 to 119.5 Lng) to speed up area resolving
    return `
      [out:json][timeout:25];
      area[name~"${escaped}",i](0.8,99.5,7.3,119.5)->.searchArea;
      (
        way["building"](area.searchArea);
        relation["building"](area.searchArea);
      );
      out geom;
    `;
  }

  /**
   * Fetch data from the Overpass API.
   * @param {string} query - Overpass QL query string.
   * @returns {Promise<Object>} Overpass JSON response.
   */
  async function fetchOverpass(query) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Overpass API terlalu sibuk (rate limit). Cuba lagi selepas beberapa saat.');
      }
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Auto-match residents to building polygons by house number.
   *
   * Strategy:
   * 1. Extract house numbers from resident addresses using multiple regex patterns.
   * 2. Extract addr:housenumber from GeoJSON feature properties.
   * 3. Match by normalized house number.
   *
   * @param {Object} geojson - GeoJSON FeatureCollection.
   * @param {Array} residents - All resident data.
   * @param {string} tamanName - The estate name for address filtering.
   * @returns {{lookup: Map, matchedCount: number}}
   */
  function matchResidents(geojson, residents, tamanName) {
    matchedPolygons.clear();

    // Step A: Build a house-number → residents lookup from CSV data
    const addressLookup = new Map(); // normalizedHouseNum → [resident, ...]

    const tamanLower = tamanName.toLowerCase();

    residents.forEach((resident) => {
      const addr = resident.address;
      const houseNum = extractHouseNumber(addr);

      if (houseNum) {
        const normalized = normalizeHouseNumber(houseNum);

        // Optionally filter to only residents whose address contains the taman name
        // This improves accuracy when multiple tamans share house numbers
        const addrLower = addr.toLowerCase();
        const isRelevant = addrLower.includes(tamanLower) || true; // Include all for now

        if (isRelevant) {
          if (!addressLookup.has(normalized)) {
            addressLookup.set(normalized, []);
          }
          addressLookup.get(normalized).push(resident);
        }
      }
    });

    console.log(`[PolygonMap] Address lookup built: ${addressLookup.size} unique house numbers.`);

    // Step B: Match GeoJSON features to residents
    let matchedCount = 0;

    geojson.features.forEach((feature) => {
      const tags = feature.properties || {};
      // osmtogeojson puts OSM tags directly in properties
      const osmHouseNum = tags['addr:housenumber'] || tags.housenumber || '';

      if (osmHouseNum) {
        const normalized = normalizeHouseNumber(osmHouseNum);

        if (addressLookup.has(normalized)) {
          // Found a match!
          feature.properties._matched = true;
          feature.properties._residents = addressLookup.get(normalized);
          matchedCount++;
        }
      }
    });

    console.log(`[PolygonMap] Matched ${matchedCount} polygons to resident data.`);

    return { lookup: addressLookup, matchedCount };
  }

  /**
   * Extract house number from a Malaysian address string.
   * Handles common formats:
   *   - "No. 23, Jalan Mawar..."
   *   - "No 5A, Lorong 2..."
   *   - "23-1, Jalan..."
   *   - "Lot 15, ..."
   *   - "PT 123, ..."
   *   - "B-12-3, ..."
   *   - "23, Jalan..."
   *
   * @param {string} address
   * @returns {string|null}
   */
  function extractHouseNumber(address) {
    if (!address) return null;

    const patterns = [
      // "No. 23A" or "No 23" or "NO. 23-1"
      /\bNo\.?\s*(\d+[\w-]*)/i,
      // "Lot 15" or "LOT 15A"
      /\bLot\.?\s*(\d+[\w-]*)/i,
      // "PT 123" or "PT123"
      /\bPT\.?\s*(\d+[\w-]*)/i,
      // Block format: "B-12-3"
      /\b([A-Z]-\d+(?:-\d+)?)\b/i,
      // Leading number: "23, Jalan..." or "23A Jalan..."
      /^(\d+[\w-]*)\s*[,\s]/,
    ];

    for (const pattern of patterns) {
      const match = address.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Normalize a house number for comparison.
   * - Uppercase
   * - Remove leading zeros
   * - Trim whitespace
   *
   * @param {string} num
   * @returns {string}
   */
  function normalizeHouseNumber(num) {
    return String(num)
      .trim()
      .toUpperCase()
      .replace(/^0+(\d)/, '$1'); // Remove leading zeros
  }

  /**
   * Render GeoJSON polygons on the Leaflet map by delegating to DrawMap.
   * @param {L.Map} map
   * @param {Object} geojson - GeoJSON FeatureCollection.
   * @param {Map} addressLookup - House number lookup map.
   */
  function renderPolygons(map, geojson, addressLookup) {
    if (typeof DrawMap !== 'undefined' && DrawMap.addGeoJSON) {
      DrawMap.addGeoJSON(geojson);
      
      // Fit the map to the new polygon bounds
      const tempLayer = L.geoJSON(geojson);
      if (tempLayer.getBounds().isValid()) {
        map.fitBounds(tempLayer.getBounds(), { padding: [50, 50], maxZoom: 18 });
      }
    } else {
      console.error('[PolygonMap] DrawMap not available to render polygons.');
    }
  }

  /**
   * Build popup HTML for a matched polygon with resident data.
   * @param {Array} residents
   * @param {Object} feature - GeoJSON feature.
   * @returns {string}
   */
  function buildResidentPopup(residents, feature) {
    const houseNum = feature.properties['addr:housenumber'] || feature.properties.housenumber || '—';
    const street = feature.properties['addr:street'] || '';

    let residentsHTML = residents
      .map(
        (r) => `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(148,163,184,0.1);">
          <div class="popup-name" style="font-size: 0.85rem;">${escapeHtml(r.name)}</div>
          ${r.rekodMIR
            ? `<span class="popup-badge">MIR ${escapeHtml(r.rekodMIR)}</span>`
            : ''
          }
          <div class="popup-row" style="margin-top: 4px;">
            <span class="popup-row-icon">📍</span>
            <span class="popup-row-text">${escapeHtml(r.address)}</span>
          </div>
        </div>
      `
      )
      .join('');

    return `
      <div class="popup-content">
        <div class="popup-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.1rem;">🏠</span>
            <div>
              <div class="popup-name">Lot ${escapeHtml(houseNum)}</div>
              ${street ? `<div style="font-size: 0.7rem; color: var(--color-text-muted);">${escapeHtml(street)}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="popup-body" style="max-height: 200px; overflow-y: auto;">
          ${residentsHTML}
        </div>
      </div>
    `;
  }

  /**
   * Build popup HTML for an unmatched polygon.
   * @param {Object} feature - GeoJSON feature.
   * @returns {string}
   */
  function buildEmptyPopup(feature) {
    const houseNum = feature.properties['addr:housenumber'] || feature.properties.housenumber || '';
    const street = feature.properties['addr:street'] || '';

    return `
      <div class="popup-content">
        <div class="popup-empty">
          <div class="popup-empty-icon">🏚️</div>
          <div class="popup-empty-text">Tiada Data Penghuni</div>
          ${houseNum
            ? `<div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 4px;">Lot ${escapeHtml(houseNum)}${street ? ', ' + escapeHtml(street) : ''}</div>`
            : ''
          }
        </div>
      </div>
    `;
  }

  /**
   * Find matched polygons by resident search.
   * @param {string} query
   * @returns {Array<{feature: Object, residents: Array, layer: L.Layer}>}
   */
  function findMatchedPolygons(query) {
    if (typeof DrawMap !== 'undefined' && DrawMap.findMatchedPolygons) {
      return DrawMap.findMatchedPolygons(query);
    }
    return [];
  }

  /**
   * Toggle polygon layer visibility by delegating to DrawMap.
   * @param {L.Map} map
   * @param {boolean} visible
   */
  function setVisible(map, visible) {
    if (typeof DrawMap !== 'undefined' && DrawMap.setVisible) {
      DrawMap.setVisible(map, visible);
    }
  }

  /**
   * Get the last matched polygon count.
   * @returns {number}
   */
  function getMatchedCount() {
    return lastMatchedCount;
  }

  /**
   * Escape HTML entities.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Fetch building footprints from an ArcGIS REST API /query endpoint.
   * @param {L.Map} map
   * @param {string} baseUrl
   * @param {Array} residents
   * @returns {Promise<{total: number, matched: number}>}
   */
  async function fetchArcGIS(map, baseUrl, residents) {
    UI.showToast(`Mula menarik data dari ArcGIS...`, 'info', 3000);

    const allFeatures = [];
    const maxFeatures = 5000; // Hard limit to avoid browser crash
    const recordCount = 1000;
    let offset = 0;
    let hasMore = true;

    try {
      while (hasMore && allFeatures.length < maxFeatures) {
        // Bina URL pencarian
        const urlObj = new URL(baseUrl);
        urlObj.searchParams.set('where', '1=1'); // Ambil semua
        urlObj.searchParams.set('outFields', '*'); // Ambil semua attributes
        urlObj.searchParams.set('f', 'geojson'); // Format output GeoJSON
        urlObj.searchParams.set('returnGeometry', 'true');
        urlObj.searchParams.set('resultOffset', offset);
        urlObj.searchParams.set('resultRecordCount', recordCount);

        const response = await fetch(urlObj.toString(), {
          // Sesetengah server mungkin sekat jika Origin berbeza, kita harap CORS dibenarkan
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`Gagal menyambung ke ArcGIS: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.error) {
          throw new Error(`Ralat ArcGIS: ${data.error.message || 'Ralat tidak diketahui'}`);
        }

        const features = data.features || [];
        allFeatures.push(...features);

        // Semak jika ada lagi rekod (exceededTransferLimit)
        if (data.exceededTransferLimit) {
          offset += recordCount;
          UI.showToast(`Menarik rekod ${offset}...`, 'info', 2000);
          // Beri sedikit rehat untuk elak UI freeze
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          hasMore = false; // Tiada lagi data
        }
      }

      if (allFeatures.length === 0) {
        UI.showToast('Tiada poligon dijumpai di URL tersebut.', 'error');
        return { total: 0, matched: 0 };
      }

      console.log(`[PolygonMap] ArcGIS return ${allFeatures.length} features.`);

      // Bina FeatureCollection GeoJSON
      const geojson = {
        type: 'FeatureCollection',
        features: allFeatures
      };

      // Buat padanan (guna nama kosong kerana ArcGIS mungkin cover kawasan besar)
      const matchResult = matchResidents(geojson, residents, "");

      // Lukis poligon ke atas peta
      renderPolygons(map, geojson, matchResult.lookup);

      UI.showToast(
        `Selesai! ${allFeatures.length} lot dipapar, ${matchResult.matchedCount} dipadankan.`,
        'success',
        5000
      );

      lastMatchedCount = matchResult.matchedCount;

      return {
        total: allFeatures.length,
        matched: matchResult.matchedCount,
      };

    } catch (err) {
      console.error('[PolygonMap ArcGIS]', err);
      UI.showToast(`Ralat semasa menarik data: ${err.message}`, 'error', 6000);
      return { total: 0, matched: 0 };
    }
  }

  return {
    searchTaman,
    fetchArcGIS,
    findMatchedPolygons,
    setVisible,
    getMatchedCount,
    buildResidentPopup,
    extractHouseNumber,
    normalizeHouseNumber,
  };
})();
