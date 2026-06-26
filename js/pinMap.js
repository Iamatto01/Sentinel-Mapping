/**
 * pinMap.js — Pin Marker Module (Feature A)
 * Plots standard Leaflet markers for residents with known coordinates.
 */

const PinMap = (() => {
  /** @type {L.LayerGroup|null} */
  let pinLayerGroup = null;

  /** @type {Map<string, {marker: L.Marker, resident: Object}>} */
  const markerLookup = new Map();

  /**
   * Build a styled popup HTML string for a resident.
   * @param {Object} resident
   * @returns {string} HTML string
   */
  function buildPopupHTML(resident) {
    return `
      <div class="popup-content">
        <div class="popup-header">
          <div class="popup-name">${escapeHtml(resident.name)}</div>
          ${resident.rekodMIR
            ? `<span class="popup-badge">MIR ${escapeHtml(resident.rekodMIR)}</span>`
            : ''
          }
        </div>
        <div class="popup-body">
          <div class="popup-row">
            <span class="popup-row-icon">📍</span>
            <span class="popup-row-text">${escapeHtml(resident.address)}</span>
          </div>
          <div class="popup-row">
            <span class="popup-row-icon">🌐</span>
            <span class="popup-row-text" style="font-size:0.68rem; color: var(--color-text-muted);">
              ${resident.lat.toFixed(6)}, ${resident.lng.toFixed(6)}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Plot all pin markers on the map.
   * @param {L.Map} map - The Leaflet map instance.
   * @param {Array} residents - Parsed resident objects.
   * @returns {number} Number of pins plotted.
   */
  function plotPins(map, residents) {
    // Clear existing pins
    if (pinLayerGroup) {
      pinLayerGroup.clearLayers();
    }
    markerLookup.clear();

    pinLayerGroup = L.layerGroup();
    let count = 0;

    residents.forEach((resident) => {
      if (!resident.hasCoordinates) return;

      // Create custom div icon for the marker
      const icon = L.divIcon({
        className: 'custom-marker-wrapper',
        html: '<div class="custom-marker"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -12],
      });

      const marker = L.marker([resident.lat, resident.lng], { icon })
        .bindPopup(buildPopupHTML(resident), {
          maxWidth: 280,
          minWidth: 200,
          className: 'custom-popup',
        });

      pinLayerGroup.addLayer(marker);

      // Store in lookup for search functionality (key = lowercase name)
      const lookupKey = `${resident.name.toLowerCase()}|||${resident.address.toLowerCase()}`;
      markerLookup.set(lookupKey, { marker, resident });

      count++;
    });

    pinLayerGroup.addTo(map);
    console.log(`[PinMap] Plotted ${count} pin markers.`);
    return count;
  }

  /**
   * Find a marker by resident name/address for search navigation.
   * @param {string} query - Search query (partial match).
   * @returns {Array<{marker: L.Marker, resident: Object}>} Matching entries.
   */
  function findMarkers(query) {
    const q = query.toLowerCase().trim();
    const results = [];

    markerLookup.forEach(({ marker, resident }) => {
      if (
        resident.name.toLowerCase().includes(q) ||
        resident.address.toLowerCase().includes(q)
      ) {
        results.push({ marker, resident });
      }
    });

    return results;
  }

  /**
   * Highlight a specific marker (add pulse animation).
   * @param {L.Marker} marker
   */
  function highlightMarker(marker) {
    // Remove previous highlights
    clearHighlights();

    const el = marker.getElement();
    if (el) {
      const dot = el.querySelector('.custom-marker');
      if (dot) dot.classList.add('highlight');
    }
  }

  /**
   * Remove all marker highlights.
   */
  function clearHighlights() {
    document.querySelectorAll('.custom-marker.highlight').forEach((el) => {
      el.classList.remove('highlight');
    });
  }

  /**
   * Toggle pin layer visibility.
   * @param {L.Map} map
   * @param {boolean} visible
   */
  function setVisible(map, visible) {
    if (!pinLayerGroup) return;
    if (visible && !map.hasLayer(pinLayerGroup)) {
      pinLayerGroup.addTo(map);
    } else if (!visible && map.hasLayer(pinLayerGroup)) {
      map.removeLayer(pinLayerGroup);
    }
  }

  /**
   * Escape HTML entities to prevent XSS.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    plotPins,
    findMarkers,
    highlightMarker,
    clearHighlights,
    setVisible,
  };
})();
