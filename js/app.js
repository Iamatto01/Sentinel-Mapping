/**
 * app.js — Main Application Orchestrator
 * Initializes the Leaflet map, loads CSV data, wires up all modules.
 */

const App = (() => {
  // --- Application State ---
  const state = {
    map: null,
    residents: [],
    pinCount: 0,
    matchedCount: 0,
    pmTilesLayer: null,
  };

  // Default map center: N56 constituency area
  const DEFAULT_CENTER = [2.8833, 101.7342];
  const DEFAULT_ZOOM = 13;

  /**
   * Initialize the entire application.
   */
  async function init() {
    console.log('[App] Initializing SentinalMapping...');

    // 1. Initialize UI components
    UI.initSidebarToggle();
    UI.showLoading('Memulakan peta...');

    // 2. Initialize Leaflet map
    initMap();

    // 3. Load CSV data
    try {
      UI.updateLoadingText('Memuat turun data pemilih...');
      state.residents = await CSVLoader.loadCSV();
      console.log(`[App] Loaded ${state.residents.length} residents.`);
    } catch (err) {
      console.error('[App] CSV load failed:', err);
      state.residents = [];
    }

    // 4. Plot pin markers for residents with coordinates
    if (state.residents.length > 0) {
      UI.updateLoadingText('Memapar penanda peta...');
      state.pinCount = PinMap.plotPins(state.map, state.residents);
      PinMap.setVisible(state.map, false); // Hide by default
    }

    // 5. Update statistics
    UI.updateStats(state.residents.length, state.pinCount, state.matchedCount);

    // 6. Initialize search
    Search.init(state.map);

    // 7. Wire up Taman search
    initTamanSearch();

    // 7.5. Wire up ArcGIS Fetcher
    initArcGISFetcher();

    // 8. Wire up layer toggles
    initLayerToggles();

    // 8.5 Initialize drawing map (Geoman)
    if (typeof DrawMap !== 'undefined') {
      DrawMap.init(state.map, state.residents);
    }

    // 9. All done — hide loader
    UI.hideLoading();

    if (state.residents.length > 0) {
      UI.showToast(
        `${state.residents.length} rekod dimuatkan, ${state.pinCount} penanda dipapar.`,
        'success'
      );
    }

    console.log('[App] Initialization complete.');
  }

  /**
   * Initialize the Leaflet map with tile layers and controls.
   */
  function initMap() {
    state.map = L.map('map', {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false, // We'll add it in a custom position
      attributionControl: true,
      maxZoom: 24,
    });

    // Tile layers
    const osmLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 24,
        maxNativeZoom: 19,
      }
    );

    const darkLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 24,
        maxNativeZoom: 19,
      }
    );

    const satelliteLayer = L.tileLayer(
      'http://mt0.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
      {
        attribution: '&copy; Google Maps',
        maxZoom: 24,
        maxNativeZoom: 20,
      }
    );

    // Default to satellite map
    satelliteLayer.addTo(state.map);

    // Zoom control (top-right)
    L.control.zoom({ position: 'topright' }).addTo(state.map);

    // Layer control
    const baseMaps = {
      '🌑 Gelap': darkLayer,
      '🗺️ Standard': osmLayer,
      '🛰️ Satelit': satelliteLayer,
    };

    L.control.layers(baseMaps, null, {
      position: 'topright',
      collapsed: true,
    }).addTo(state.map);

    // Try loading local PMTiles if available
    initPMTiles();
  }

  /**
   * Initialize local PMTiles vector layer if 'data/buildings.pmtiles' exists.
   */
  async function initPMTiles() {
    try {
      // Check if file exists (using HEAD request)
      const res = await fetch('data/buildings.pmtiles', { method: 'HEAD' });
      if (res.ok) {
        console.log('[PMTiles] Local buildings.pmtiles found. Loading vector layer...');
        
        // Define painting rules for the vector polygons
        const paintRules = [
          {
            dataLayer: 'sepang_microsoft_ai',
            symbolizer: new protomapsL.PolygonSymbolizer({
              fill: 'transparent',
              stroke: '#3b82f6',
              width: 1
            })
          }
        ];

        state.pmTilesLayer = protomapsL.leafletLayer({
          url: 'data/buildings.pmtiles',
          paintRules: paintRules,
          pane: 'overlayPane',
          zIndex: 500,
          maxDataZoom: 15
        });
        
        state.pmTilesLayer.addTo(state.map);
        UI.showToast('Lapisan rujukan bangunan (PMTiles) berjaya dimuatkan.', 'success');
      }
    } catch (err) {
      console.error('[PMTiles] Error loading vector tiles:', err);
    }
  }

  /**
   * Wire up the Taman/estate search input and button.
   */
  function initTamanSearch() {
    const input = document.getElementById('input-taman');
    const btn = document.getElementById('btn-taman-search');
    const resultsContainer = document.getElementById('taman-search-results');

    if (!input || !btn || !resultsContainer) return;

    let debounceTimer = null;

    const refreshStats = () => {
      let customCount = 0;
      if (typeof DrawMap !== 'undefined' && DrawMap.getCustomPolygonsCount) {
        customCount = DrawMap.getCustomPolygonsCount();
      }
      UI.updateStats(state.residents.length, state.pinCount, state.matchedCount + customCount);
    };

    // Listen for custom polygon updates
    document.addEventListener('sentinal:polygonsUpdated', refreshStats);

    const doSearch = async (val, bbox = null) => {
      const estateName = val || input.value.trim();
      if (!estateName) {
        UI.showToast('Sila masukkan nama taman/perumahan.', 'info');
        return;
      }

      resultsContainer.classList.remove('active');

      const result = await PolygonMap.searchTaman(
        estateName,
        state.map,
        state.residents,
        bbox
      );

      state.matchedCount = result.matched;
      refreshStats();
    };

    // Auto-suggest autocomplete from ArcGIS
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value.trim();

      if (query.length < 3) {
        resultsContainer.classList.remove('active');
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          // Query ArcGIS Suggest with location bias
          const center = state.map.getCenter();
          const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?f=json&text=${encodeURIComponent(query)}&countryCode=MYS&location=${center.lng},${center.lat}&maxSuggestions=5`;
          const response = await fetch(url);
          if (!response.ok) return;
          const data = await response.json();

          if (data && data.suggestions && data.suggestions.length > 0) {
            resultsContainer.innerHTML = data.suggestions
              .map((item, idx) => {
                const name = item.text.split(',')[0];
                const sub = item.text;
                return `
                  <div class="search-result-item" data-idx="${idx}">
                    <div class="result-name">📍 ${name}</div>
                    <div class="result-address" style="font-size: 0.68rem;">${sub}</div>
                  </div>
                `;
              })
              .join('');
            resultsContainer.classList.add('active');

            // Click handler for suggestion item
            resultsContainer.querySelectorAll('.search-result-item').forEach(el => {
              el.addEventListener('click', async () => {
                const idx = parseInt(el.dataset.idx, 10);
                const chosen = data.suggestions[idx];
                const cleanName = chosen.text.split(',')[0];
                input.value = cleanName;
                resultsContainer.classList.remove('active');
                
                // Fetch exact location via magicKey
                try {
                  const candUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&magicKey=${chosen.magicKey}&outSR=4326&maxLocations=1`;
                  const candRes = await fetch(candUrl);
                  const candData = await candRes.json();
                  
                  if (candData.candidates && candData.candidates.length > 0) {
                    const ext = candData.candidates[0].extent;
                    let s = ext.ymin, n = ext.ymax, w = ext.xmin, e = ext.xmax;
                    
                    // Expand extent if it's too small (< ~300m)
                    const latDiff = n - s;
                    const lonDiff = e - w;
                    if (latDiff < 0.003) {
                      const expand = (0.003 - latDiff) / 2;
                      s -= expand; n += expand;
                    }
                    if (lonDiff < 0.003) {
                      const expand = (0.003 - lonDiff) / 2;
                      w -= expand; e += expand;
                    }
                    
                    const overpassBbox = [s, w, n, e];
                    doSearch(cleanName, overpassBbox);
                  } else {
                    doSearch(cleanName);
                  }
                } catch(e) {
                  doSearch(cleanName);
                }
              });
            });
          } else {
            resultsContainer.classList.remove('active');
          }
        } catch (err) {
          console.error('[Taman Autocomplete]', err);
        }
      }, 300);
    });

    // Close suggestion box on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !resultsContainer.contains(e.target)) {
        resultsContainer.classList.remove('active');
      }
    });

    btn.addEventListener('click', () => doSearch());

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
      if (e.key === 'Escape') {
        resultsContainer.classList.remove('active');
        input.blur();
      }
    });
  }

  /**
   * Wire up the ArcGIS REST API fetcher.
   */
  function initArcGISFetcher() {
    const input = document.getElementById('input-arcgis-url');
    const btn = document.getElementById('btn-arcgis-search');

    if (!input || !btn) return;

    btn.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) {
        UI.showToast('Sila masukkan URL ArcGIS REST API terlebih dahulu.', 'info');
        return;
      }

      // Pastikan ia diakhiri dengan /query jika ia URL FeatureServer/MapServer biasa
      let queryUrl = url;
      if (url.includes('MapServer') || url.includes('FeatureServer')) {
        if (!url.endsWith('/query') && !url.includes('/query?')) {
          queryUrl = url.replace(/\/?$/, '/query');
        }
      }

      // Tukar teks butang semasa loading
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Menarik...';

      try {
        const result = await PolygonMap.fetchArcGIS(state.map, queryUrl, state.residents);
        
        state.matchedCount = result.matched;
        UI.updateStats(state.residents.length, state.pinCount, state.matchedCount);
      } catch (err) {
        console.error('[ArcGIS Fetcher]', err);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });
  }

  /**
   * Wire up layer toggle buttons (Pins / Polygons).
   */
  function initLayerToggles() {
    const btnPins = document.getElementById('toggle-pins');
    const btnPolygons = document.getElementById('toggle-polygons');

    if (btnPins) {
      btnPins.addEventListener('click', () => {
        btnPins.classList.toggle('active');
        PinMap.setVisible(state.map, btnPins.classList.contains('active'));
      });
    }

    if (btnPolygons) {
      btnPolygons.classList.add('active');
      btnPolygons.addEventListener('click', () => {
        btnPolygons.classList.toggle('active');
        PolygonMap.setVisible(state.map, btnPolygons.classList.contains('active'));
      });
    }

    const btnPmtiles = document.getElementById('toggle-pmtiles');
    if (btnPmtiles) {
      btnPmtiles.classList.add('active');
      btnPmtiles.addEventListener('click', () => {
        btnPmtiles.classList.toggle('active');
        if (state.pmTilesLayer) {
          if (btnPmtiles.classList.contains('active')) {
            state.map.addLayer(state.pmTilesLayer);
          } else {
            state.map.removeLayer(state.pmTilesLayer);
          }
        }
      });
    }
  }

  return { init };
})();

// --- Boot the application when DOM is ready ---
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
