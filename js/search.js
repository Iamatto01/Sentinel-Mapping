/**
 * search.js — Master Search Module
 * Provides unified search across residents (pins + polygons).
 * Debounced input, dropdown results, map navigation.
 */

const Search = (() => {
  /** @type {number|null} */
  let debounceTimer = null;
  const DEBOUNCE_MS = 300;
  const MAX_RESULTS = 12;

  /** @type {L.Map|null} */
  let mapRef = null;

  /**
   * Initialize the search module.
   * @param {L.Map} map - Leaflet map instance.
   */
  function init(map) {
    mapRef = map;

    const input = document.getElementById('search-master');
    const resultsContainer = document.getElementById('search-results');

    if (!input || !resultsContainer) {
      console.warn('[Search] Search input or results container not found.');
      return;
    }

    // Debounced input listener
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();

      if (query.length < 2) {
        hideResults();
        return;
      }

      debounceTimer = setTimeout(() => {
        performSearch(query);
      }, DEBOUNCE_MS);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !resultsContainer.contains(e.target)) {
        hideResults();
      }
    });

    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        if (query.length >= 2) {
          performSearch(query);
        }
      }

      if (e.key === 'Escape') {
        hideResults();
        input.blur();
      }
    });
  }

  /**
   * Perform a unified search across pins and matched polygons.
   * @param {string} query
   */
  function performSearch(query) {
    const results = [];

    // Search pin markers
    const pinResults = PinMap.findMarkers(query);
    pinResults.forEach(({ marker, resident }) => {
      results.push({
        type: 'pin',
        name: resident.name,
        address: resident.address,
        rekodMIR: resident.rekodMIR,
        marker,
        resident,
      });
    });

    // Search matched polygons
    const polyResults = PolygonMap.findMatchedPolygons(query);
    polyResults.forEach(({ feature, residents, layer }) => {
      residents.forEach((r) => {
        if (
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.address.toLowerCase().includes(query.toLowerCase())
        ) {
          // Avoid duplicates if already in pin results
          const isDupe = results.some(
            (existing) =>
              existing.name === r.name &&
              existing.address === r.address &&
              existing.type === 'pin'
          );
          if (!isDupe) {
            results.push({
              type: 'polygon',
              name: r.name,
              address: r.address,
              rekodMIR: r.rekodMIR,
              layer,
              resident: r,
            });
          }
        }
      });
    });

    // Search custom drawn polygons (unmatched to residents)
    if (typeof DrawMap !== 'undefined' && DrawMap.searchCustomPolygons) {
      const customResults = DrawMap.searchCustomPolygons(query);
      customResults.forEach(({ feature, layer }) => {
        const houseNum = feature.properties['addr:housenumber'] || feature.properties.housenumber || 'Lot Tanpa Nama';
        const kat = feature.properties.kategori || 'Tiada Kategori';
        results.push({
          type: 'custom_polygon',
          name: houseNum,
          address: `Kategori: ${kat}`,
          rekodMIR: '-',
          layer,
          resident: null,
        });
      });
    }

    renderResults(results.slice(0, MAX_RESULTS), query);
  }

  /**
   * Render search results in the dropdown.
   * @param {Array} results
   * @param {string} query - For highlight purposes.
   */
  function renderResults(results, query) {
    const container = document.getElementById('search-results');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="search-result-item" style="cursor: default; opacity: 0.6; text-align: center;">
          <div class="result-name">Tiada keputusan</div>
          <div class="result-address">Cuba cari dengan kata kunci lain</div>
        </div>
      `;
      container.classList.add('active');
      return;
    }

    container.innerHTML = results
      .map((r, index) => {
        const typeIcon = r.type === 'pin' ? '📍' : '🏠';
        const highlightedName = highlightMatch(r.name, query);
        const highlightedAddr = highlightMatch(r.address, query);

        return `
          <div class="search-result-item" data-index="${index}">
            <div class="result-name">${typeIcon} ${highlightedName}</div>
            <div class="result-address">${highlightedAddr}</div>
          </div>
        `;
      })
      .join('');

    container.classList.add('active');

    // Bind click handlers
    container.querySelectorAll('.search-result-item[data-index]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        const result = results[idx];
        if (result) navigateToResult(result);
      });
    });
  }

  /**
   * Navigate to a search result on the map.
   * @param {Object} result
   */
  function navigateToResult(result) {
    if (!mapRef) return;

    hideResults();

    // Clear the search input
    const input = document.getElementById('search-master');
    if (input) input.value = result.name;

    if (result.type === 'pin' && result.marker) {
      // Fly to pin marker
      const latlng = result.marker.getLatLng();
      mapRef.flyTo(latlng, 17, { duration: 1 });

      // Open the popup after fly animation
      setTimeout(() => {
        result.marker.openPopup();
        PinMap.highlightMarker(result.marker);
      }, 1100);
    } else if ((result.type === 'polygon' || result.type === 'custom_polygon') && result.layer) {
      // Fly to polygon centroid
      const bounds = result.layer.getBounds();
      if (bounds.isValid()) {
        mapRef.flyToBounds(bounds, { padding: [40, 40], maxZoom: 19, duration: 1 });

        setTimeout(() => {
          result.layer.openPopup();
          // Highlight the polygon
          result.layer.setStyle({
            weight: 3,
            fillOpacity: 0.6,
            color: '#f97316',
            fillColor: '#f97316',
          });
        }, 1100);
      }
    }
  }

  /**
   * Highlight matching text in a string.
   * @param {string} text
   * @param {string} query
   * @returns {string} HTML with highlights.
   */
  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const escaped = escapeHtml(text);
    const queryEscaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${queryEscaped})`, 'gi');

    return escaped.replace(
      regex,
      '<span style="background: rgba(59, 130, 246, 0.3); border-radius: 2px; padding: 0 2px;">$1</span>'
    );
  }

  /**
   * Hide the search results dropdown.
   */
  function hideResults() {
    const container = document.getElementById('search-results');
    if (container) container.classList.remove('active');
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

  return {
    init,
    performSearch,
    hideResults,
  };
})();
