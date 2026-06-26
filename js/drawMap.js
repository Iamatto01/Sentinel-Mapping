/**
 * drawMap.js — Custom Drawing Module using Leaflet-Geoman
 * Allows users to draw, edit, and cut their own grid polygons,
 * and bind house numbers to them to match with resident data.
 */

const DrawMap = (() => {
  const LOCAL_STORAGE_KEY = 'sentinal_drawn_polygons';

  let allResidents = [];
  let activeDrawnItems = null;

  const POLITIK_COLORS = {
    'PAS': '#10b981',
    'Bersatu': '#ef4444',
    'UMNO': '#1d4ed8',
    'PKR': '#0ea5e9',
    'DAP': '#ec4899',
    'Amanah': '#f97316',
    'Lalang': '#f59e0b',
    'Tiada Data': '#6b7280'
  };

  function getCategoryColor(kat) {
    return POLITIK_COLORS[kat] || null;
  }

  /**
   * Initialize drawing controls and load saved polygons.
   * @param {L.Map} map
   * @param {Array} residents
   */
  function init(map, residents) {
    if (!map.pm) {
      console.warn('[DrawMap] Leaflet-Geoman is not loaded.');
      return;
    }

    allResidents = residents || [];

    // Initialize Geoman Controls
    map.pm.addControls({
      position: 'topright',
      drawCircle: false,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawText: false,
      drawRectangle: true,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      cutPolygon: true, // Crucial for "petak2" (cutting big blocks)
      removalMode: true,
    });

    // Change language to MS or ID if available, else EN
    map.pm.setLang('en');

    // Create a FeatureGroup to hold all drawn items
    activeDrawnItems = new L.FeatureGroup();
    activeDrawnItems.addTo(map);

    // Set path options for drawn shapes
    map.pm.setPathOptions({
      color: '#3b82f6', // Blue accent
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
    });

    // Load existing polygons from localStorage
    loadPolygons(map, activeDrawnItems);

    // Event listeners to save on change
    map.on('pm:create', (e) => {
      activeDrawnItems.addLayer(e.layer);
      addLayerListeners(e.layer, activeDrawnItems);
      savePolygons(activeDrawnItems);
    });

    map.on('pm:remove', (e) => {
      savePolygons(activeDrawnItems);
    });

    map.on('pm:cut', (e) => {
      // The original layer is removed, and new layers are added
      activeDrawnItems.removeLayer(e.originalLayer);
      e.layer.addTo(activeDrawnItems);
      addLayerListeners(e.layer, activeDrawnItems);
      savePolygons(activeDrawnItems);
    });
    
    // Add custom control to Clear All
    L.Control.ClearDrawings = L.Control.extend({
      onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        container.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
        container.style.cursor = 'pointer';
        container.style.padding = '8px 10px';
        container.style.color = '#ef4444';
        container.style.fontWeight = 'bold';
        container.style.fontSize = '12px';
        container.style.border = '1px solid var(--color-border)';
        container.style.backdropFilter = 'blur(16px)';
        
        container.innerHTML = '🗑️ Padam Lukisan';
        
        container.onclick = function(){
          if (confirm('Anda pasti mahu memadam semua lukisan petak anda?')) {
            activeDrawnItems.clearLayers();
            savePolygons(activeDrawnItems);
            UI.showToast('Semua lukisan telah dipadam.', 'info');
          }
        }
        return container;
      }
    });

    map.addControl(new L.Control.ClearDrawings({position: 'topright'}));
  }

  function addLayerListeners(layer, drawnItems) {
    layer.on('pm:edit', () => {
      savePolygons(drawnItems);
    });
    layer.on('pm:dragend', () => {
      savePolygons(drawnItems);
    });
    
    // Add data popup functionality
    updatePopup(layer);
  }

  function updatePopup(layer) {
    if (!layer.feature) {
      layer.feature = { type: 'Feature', properties: {} };
    }
    const houseNum = layer.feature.properties.housenumber || layer.feature.properties['addr:housenumber'] || '';
    const kategori = layer.feature.properties.kategori || '';
    const catColor = getCategoryColor(kategori);

    let popupHTML = '';
    
    // Only show display mode if houseNum exists OR kategori exists, AND we are not forcing edit form
    if ((houseNum || kategori) && !layer._forceEditForm) {
      // Find matching residents using houseNum if it exists
      let matchedResidents = [];
      if (houseNum) {
        const normalized = PolygonMap.normalizeHouseNumber(houseNum);
        matchedResidents = allResidents.filter(r => {
          const rNum = PolygonMap.extractHouseNumber(r.address);
          return rNum && PolygonMap.normalizeHouseNumber(rNum) === normalized;
        });
      }

      if (matchedResidents.length > 0) {
        layer.setStyle({ color: catColor || '#ef4444', fillColor: catColor || '#ef4444', fillOpacity: catColor ? 0.6 : 0.2 }); 
        layer.feature.properties['addr:housenumber'] = houseNum;
        popupHTML = PolygonMap.buildResidentPopup(matchedResidents, layer.feature);
      } else {
        layer.setStyle({ color: catColor || '#3b82f6', fillColor: catColor || '#3b82f6', fillOpacity: catColor ? 0.6 : 0.1 }); 
        layer.feature.properties['addr:housenumber'] = houseNum;
        popupHTML = PolygonMap.buildEmptyPopup(layer.feature);
      }

      // Add edit button at bottom
      popupHTML += `
        <div style="padding: 10px 16px; border-top: 1px solid var(--color-border); background: rgba(0,0,0,0.1);">
          <button onclick="DrawMap.editHouseNum(${L.stamp(layer)})" class="btn-taman-search" style="width: 100%; font-size: 0.7rem; padding: 6px;">Ubah Data / Kategori</button>
        </div>
      `;
    } else {
      // Form to enter house number and category
      layer.setStyle({ color: catColor || '#3b82f6', fillColor: catColor || '#3b82f6', fillOpacity: catColor ? 0.6 : 0.1 });
      layer._forceEditForm = false; // Reset flag
      
      const selKategori = (val) => kategori === val ? 'selected' : '';
      
      popupHTML = `
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-name">Tetapan Petak & Kategori</div>
          </div>
          <div class="popup-body" style="padding: 14px 16px;">
            <label style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 6px;">Maklumat / No. Rumah:</label>
            <input type="text" id="input-housenum-${L.stamp(layer)}" value="${houseNum}" placeholder="Cth: 23A / Yakob" style="width: 100%; margin-bottom: 12px; padding: 8px; background: rgba(15,23,42,0.8); border: 1px solid var(--color-border); color: white; border-radius: 4px;">
            
            <label style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 6px;">Kategori Politik:</label>
            <select id="input-kategori-${L.stamp(layer)}" style="width: 100%; margin-bottom: 12px; padding: 8px; background: rgba(15,23,42,0.8); border: 1px solid var(--color-border); color: white; border-radius: 4px;">
              <option value="" ${selKategori('')}>-- Tiada Pilihan --</option>
              <option value="PAS" ${selKategori('PAS')}>PAS (Hijau)</option>
              <option value="Bersatu" ${selKategori('Bersatu')}>Bersatu (Merah)</option>
              <option value="UMNO" ${selKategori('UMNO')}>UMNO (Biru)</option>
              <option value="PKR" ${selKategori('PKR')}>PKR (Biru Muda)</option>
              <option value="DAP" ${selKategori('DAP')}>DAP (Pink)</option>
              <option value="Amanah" ${selKategori('Amanah')}>Amanah (Oren)</option>
              <option value="Lalang" ${selKategori('Lalang')}>Atas Pagar / Lalang</option>
              <option value="Tiada Data" ${selKategori('Tiada Data')}>Tiada Data / Lain-lain</option>
            </select>

            <button onclick="DrawMap.saveHouseNum(${L.stamp(layer)})" class="btn-taman-search" style="width: 100%; padding: 8px;">Simpan Data</button>
          </div>
        </div>
      `;
    }

    layer.bindPopup(popupHTML, { maxWidth: 300, minWidth: 220 });
  }

  function saveHouseNum(layerId) {
    const layer = activeDrawnItems.getLayer(layerId);
    const inputNum = document.getElementById(`input-housenum-${layerId}`);
    const inputKat = document.getElementById(`input-kategori-${layerId}`);
    
    if (layer && inputNum && inputKat) {
      const valNum = inputNum.value.trim();
      const valKat = inputKat.value;
      
      if (!layer.feature) layer.feature = { type: 'Feature', properties: {} };
      layer.feature.properties.housenumber = valNum;
      layer.feature.properties.kategori = valKat;
      
      updatePopup(layer);
      layer.openPopup();
      savePolygons(activeDrawnItems);
      
      // Dispatch event to update stats in sidebar
      document.dispatchEvent(new CustomEvent('sentinal:polygonsUpdated'));
    }
  }

  function editHouseNum(layerId) {
    const layer = activeDrawnItems.getLayer(layerId);
    if (layer) {
      layer._forceEditForm = true;
      updatePopup(layer);
      layer.openPopup();
    }
  }

  /**
   * Save drawn polygons to localStorage as GeoJSON
   */
  function savePolygons(drawnItems) {
    const geojson = drawnItems.toGeoJSON();
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(geojson));
  }

  /**
   * Load drawn polygons from localStorage
   */
  function loadPolygons(map, drawnItems) {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const geojson = JSON.parse(saved);
        addGeoJSON(geojson);
        console.log('[DrawMap] Loaded custom polygons from storage.');
      } catch (e) {
        console.error('[DrawMap] Error loading polygons from storage', e);
      }
    }
  }

  /**
   * Add a GeoJSON FeatureCollection to the editable drawn layer
   */
  function addGeoJSON(geojson) {
    if (!activeDrawnItems) return;
    
    L.geoJSON(geojson, {
      style: {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
      },
      onEachFeature: (feature, layer) => {
        activeDrawnItems.addLayer(layer);
        addLayerListeners(layer, activeDrawnItems);
      }
    });

    // Update UI Stats
    document.dispatchEvent(new CustomEvent('sentinal:polygonsUpdated'));
    savePolygons(activeDrawnItems);
  }

  function setVisible(map, visible) {
    if (!activeDrawnItems) return;
    if (visible && !map.hasLayer(activeDrawnItems)) {
      activeDrawnItems.addTo(map);
    } else if (!visible && map.hasLayer(activeDrawnItems)) {
      map.removeLayer(activeDrawnItems);
    }
  }

  function findMatchedPolygons(query) {
    const results = [];
    const q = query.toLowerCase().trim();
    if (!activeDrawnItems) return results;

    activeDrawnItems.eachLayer((layer) => {
      const feature = layer.feature;
      if (!feature || !feature.properties) return;
      const houseNum = feature.properties.housenumber || feature.properties['addr:housenumber'];
      if (!houseNum) return;

      const normalized = PolygonMap.normalizeHouseNumber(houseNum);
      const matchedResidents = allResidents.filter(r => {
        const rNum = PolygonMap.extractHouseNumber(r.address);
        return rNum && PolygonMap.normalizeHouseNumber(rNum) === normalized;
      });

      if (matchedResidents.length === 0) return;

      const match = matchedResidents.some(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.address.toLowerCase().includes(q)
      );

      if (match) {
        results.push({ feature, residents: matchedResidents, layer });
      }
    });

    return results;
  }

  function searchCustomPolygons(query) {
    const results = [];
    const q = query.toLowerCase().trim();
    if (!activeDrawnItems) return results;

    activeDrawnItems.eachLayer((layer) => {
      const feature = layer.feature;
      if (!feature || !feature.properties) return;
      const houseNum = feature.properties['addr:housenumber'] || feature.properties.housenumber || '';
      const kat = feature.properties.kategori || '';

      if (!houseNum && !kat) return;

      const normalized = PolygonMap.normalizeHouseNumber(houseNum);
      const matchedResidents = allResidents.filter(r => {
        const rNum = PolygonMap.extractHouseNumber(r.address);
        return rNum && PolygonMap.normalizeHouseNumber(rNum) === normalized;
      });

      // Only return as custom if it did NOT match any resident (otherwise findMatchedPolygons handles it)
      if (matchedResidents.length === 0) {
        if (houseNum.toLowerCase().includes(q) || kat.toLowerCase().includes(q)) {
          results.push({ feature, layer });
        }
      }
    });
    return results;
  }

  function getCustomPolygonsCount() {
    let count = 0;
    if (!activeDrawnItems) return count;

    activeDrawnItems.eachLayer((layer) => {
      const feature = layer.feature;
      if (!feature || !feature.properties) return;
      const houseNum = feature.properties['addr:housenumber'] || feature.properties.housenumber || '';
      const kat = feature.properties.kategori || '';

      if (houseNum || kat) {
        const normalized = PolygonMap.normalizeHouseNumber(houseNum);
        const matchedResidents = allResidents.filter(r => {
          const rNum = PolygonMap.extractHouseNumber(r.address);
          return rNum && PolygonMap.normalizeHouseNumber(rNum) === normalized;
        });
        
        // Count it if it's uniquely labeled/custom
        if (matchedResidents.length === 0) {
          count++;
        }
      }
    });
    return count;
  }

  return { 
    init,
    setVisible,
    addGeoJSON,
    savePolygons,
    saveHouseNum,
    editHouseNum,
    findMatchedPolygons,
    searchCustomPolygons,
    getCustomPolygonsCount,
    getCategoryColor
  };
})();
