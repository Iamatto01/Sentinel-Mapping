/**
 * supabaseClient.js — Handles all interactions with Supabase
 */

const SupabaseClient = (() => {
  // Initialize the Supabase client
  const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

  /**
   * Fetch all drawn polygons from the database
   * @returns {Promise<Object>} A GeoJSON FeatureCollection
   */
  async function fetchPolygons() {
    try {
      const { data, error } = await supabase
        .from('polygons')
        .select('feature');

      if (error) throw error;

      // Wrap the array of features into a GeoJSON FeatureCollection
      return {
        type: 'FeatureCollection',
        features: data ? data.map(row => row.feature) : []
      };
    } catch (err) {
      console.error('[Supabase] Fetch Polygons Error:', err);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  /**
   * Save the entire FeatureCollection to Supabase.
   * Since we want a simple sync for MVP, we will clear the table and insert the new features.
   * A more robust approach would be upserting based on feature IDs, but Leaflet-Geoman doesn't strictly track UUIDs out of the box unless we add them.
   * @param {Object} geojson FeatureCollection
   */
  async function saveAllPolygons(geojson) {
    try {
      if (!geojson || !geojson.features) return;

      // 1. Delete all existing records (simple sync for MVP)
      const { error: deleteError } = await supabase
        .from('polygons')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (deleteError) throw deleteError;

      // 2. Insert new features
      if (geojson.features.length > 0) {
        const rowsToInsert = geojson.features.map(feature => ({
          feature: feature
        }));

        const { error: insertError } = await supabase
          .from('polygons')
          .insert(rowsToInsert);

        if (insertError) throw insertError;
      }
      
      console.log(`[Supabase] Synced ${geojson.features.length} polygons.`);
    } catch (err) {
      console.error('[Supabase] Save Polygons Error:', err);
      UI.showToast('Gagal menyimpan lukisan ke pangkalan data', 'error');
    }
  }

  return {
    fetchPolygons,
    saveAllPolygons,
    supabase
  };
})();
