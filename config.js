// Replace these two values after creating the Supabase project.
// The anon/publishable key is intended to be used in browser apps; security is enforced by RLS + RPCs in supabase.sql.
window.HNS_CONFIG = {
  SUPABASE_URL: "https://yvgxhetrbhxvrutynfls.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_VWDXP5Gl5gOV-DEuZu6Q3g_plhzZNzU",
  // Primary + fallbacks. The app automatically tries the next server on 429/502/503/504 or timeout.
  OVERPASS_ENDPOINT: "https://overpass-api.de/api/interpreter",
  OVERPASS_ENDPOINTS: [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ],
  OSM_CACHE_HOURS: 168
};
