// Replace these two values after creating the Supabase project.
// The anon/publishable key is intended to be used in browser apps; security is enforced by RLS + RPCs in supabase.sql.
window.HNS_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  // Primary + fallbacks. The app automatically tries the next server on 429/502/503/504 or timeout.
  OVERPASS_ENDPOINT: "https://overpass.private.coffee/api/interpreter",
  OVERPASS_ENDPOINTS: [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter"
  ],
  OSM_CACHE_HOURS: 168
};
