/**
 * csvLoader.js — CSV Data Loader
 * Fetches and parses the published Google Sheets CSV using PapaParse.
 */

const CSVLoader = (() => {

  // ============================================================
  // ⬇️⬇️⬇️ PASTE YOUR GOOGLE SHEETS CSV URL HERE ⬇️⬇️⬇️
  // 
  // How to get this URL:
  //   1. Open your Google Sheet
  //   2. Go to File → Share → Publish to web
  //   3. Select the correct sheet tab
  //   4. Change format to "Comma-separated values (.csv)"
  //   5. Click Publish and paste the resulting URL below
  //
  const CSV_URL = 'YOUR_GOOGLE_SHEETS_CSV_URL_HERE';
  //
  // ⬆️⬆️⬆️ PASTE YOUR GOOGLE SHEETS CSV URL HERE ⬆️⬆️⬆️
  // ============================================================

  /**
   * Load and parse the CSV data.
   * @returns {Promise<Array>} Resolves with an array of resident objects.
   */
  function loadCSV() {
    return new Promise((resolve, reject) => {
      // Validate that the URL has been configured
      if (!CSV_URL || CSV_URL === 'YOUR_GOOGLE_SHEETS_CSV_URL_HERE') {
        const errorMsg = 'CSV URL belum dikonfigurasi. Sila masukkan URL Google Sheets anda di dalam fail js/csvLoader.js';
        console.error('[CSVLoader]', errorMsg);
        UI.showToast(errorMsg, 'error', 8000);

        // Resolve with empty array so the app still loads
        resolve([]);
        return;
      }

      UI.updateLoadingText('Memuat turun data CSV...');

      Papa.parse(CSV_URL, {
        download: true,
        header: true,
        skipEmptyLines: 'greedy',
        dynamicTyping: false, // Keep everything as strings for safe parsing
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            console.warn('[CSVLoader] Parse warnings:', results.errors);
          }

          // Validate and clean the data
          const cleanedData = cleanData(results.data);
          console.log(`[CSVLoader] Loaded ${cleanedData.length} valid records.`);

          resolve(cleanedData);
        },
        error: (err) => {
          console.error('[CSVLoader] Fetch/parse error:', err);
          UI.showToast('Gagal memuat data CSV. Sila semak URL dan cuba lagi.', 'error', 6000);
          reject(err);
        },
      });
    });
  }

  /**
   * Clean and validate parsed CSV rows.
   * @param {Array} rawData - Raw parsed rows from PapaParse.
   * @returns {Array} Cleaned resident objects.
   */
  function cleanData(rawData) {
    const requiredFields = ['Nama Pemilih', 'Alamat Kediaman'];

    return rawData
      .filter((row) => {
        // Must have at least a name and address
        return requiredFields.every(
          (field) => row[field] && String(row[field]).trim().length > 0
        );
      })
      .map((row) => {
        const lat = parseCoordinate(row['Latitude']);
        const lng = parseCoordinate(row['Longitude']);

        return {
          name: String(row['Nama Pemilih'] || '').trim(),
          address: String(row['Alamat Kediaman'] || '').trim(),
          rekodMIR: String(row['Rekod MIR'] || '').trim(),
          lat: lat,
          lng: lng,
          hasCoordinates: lat !== null && lng !== null,
          // Store the original row for debugging
          _raw: row,
        };
      });
  }

  /**
   * Parse a coordinate value safely.
   * @param {*} value - Raw value from CSV.
   * @returns {number|null} Parsed float or null.
   */
  function parseCoordinate(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    const num = parseFloat(String(value).trim());
    return isNaN(num) ? null : num;
  }

  return {
    loadCSV,
  };
})();
