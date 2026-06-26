/**
 * drawMap.js — Custom Drawing Module using Leaflet-Geoman
 * Allows users to draw, edit, and cut their own grid polygons,
 * and bind house numbers to them to match with resident data.
 */

const DrawMap = (() => {
  const LOCAL_STORAGE_KEY = 'sentinal_drawn_polygons';

  let allResidents = [];
  let activeDrawnItems = null;

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

    let popupHTML = '';
    if (houseNum) {
      // Find matching residents
      const normalized = PolygonMap.normalizeHouseNumber(houseNum);
      const matchedResidents = allResidents.filter(r => {
        const rNum = PolygonMap.extractHouseNumber(r.address);
        return rNum && PolygonMap.normalizeHouseNumber(rNum) === normalized;
      });

      if (matchedResidents.length > 0) {
        layer.setStyle({ color: '#ef4444', fillColor: '#ef4444' }); // Red for matched
        layer.feature.properties['addr:housenumber'] = houseNum;
        popupHTML = PolygonMap.buildResidentPopup(matchedResidents, layer.feature);
      } else {
        layer.setStyle({ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1 }); // Blue for unmatched but has data
        layer.feature.properties['addr:housenumber'] = houseNum;
        popupHTML = PolygonMap.buildEmptyPopup(layer.feature);
      }

      // Add edit button at bottom
      popupHTML += `
        <div style="padding: 10px 16px; border-top: 1px solid var(--color-border); background: rgba(0,0,0,0.1);">
          <button onclick="DrawMap.editHouseNum(${L.stamp(layer)})" class="btn-taman-search" style="width: 100%; font-size: 0.7rem; padding: 6px;">Ubah No. Rumah / Lot</button>
        </div>
      `;
    } else {
      // Form to enter house number
      layer.setStyle({ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1 }); // Blue for newly drawn without data
      popupHTML = `
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-name">Tetapan Petak Baru</div>
          </div>
          <div class="popup-body" style="padding: 14px 16px;">
            <label style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 6px;">Masukkan No. Rumah / Lot:</label>
            <input type="text" id="input-housenum-${L.stamp(layer)}" placeholder="Cth: 23A, Lot 15" style="width: 100%; margin-bottom: 10px; padding: 8px; background: rgba(15,23,42,0.8); border: 1px solid var(--color-border); color: white; border-radius: 4px;">
            <button onclick="DrawMap.saveHouseNum(${L.stamp(layer)})" class="btn-taman-search" style="width: 100%; padding: 8px;">Simpan Data</button>
          </div>
        </div>
      `;
    }

    layer.bindPopup(popupHTML, { maxWidth: 300, minWidth: 220 });
  }

  function saveHouseNum(layerId) {
    const layer = activeDrawnItems.getLayer(layerId);
    const input = document.getElementById(`input-housenum-${layerId}`);
    if (layer && input) {
      const val = input.value.trim();
      if (!val) return;
      if (!layer.feature) layer.feature = { type: 'Feature', properties: {} };
      layer.feature.properties.housenumber = val;
      updatePopup(layer);
      layer.openPopup();
      savePolygons(activeDrawnItems);
    }
  }

  function editHouseNum(layerId) {
    const layer = activeDrawnItems.getLayer(layerId);
    if (layer) {
      // Temporarily clear it so updatePopup shows the input form
      layer.feature.properties.housenumber = ''; 
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

  return { 
    init,
    saveHouseNum,
    editHouseNum,
    addGeoJSON,
    setVisible,
    findMatchedPolygons
  };
})();
