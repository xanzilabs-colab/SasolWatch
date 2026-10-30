# SasolSniff dashboard notes

- The root `fusion.ts` was already present and matches the provided rule engine. `lib/fusion.ts` re-exports it so simulator logic stays identical without maintaining a second copy.
- The browser uses only the Supabase anon key, reads public dashboard tables, and performs no database writes. `alert_recipients` is never queried.
- No login is included. With missing Supabase settings, the app opens directly to a setup screen; with settings present, it opens directly to the dashboard.
- In simulator mode, a local fallback node is used if Supabase has no node row. Simulated readings and alert previews remain in browser state only.
- Candidate facility positions and pollutant concentrations are marked illustrative/simulated throughout.
