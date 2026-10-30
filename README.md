# SasolSniff

SasolSniff is an air-quality early-warning prototype for monitoring changes in sensor response, estimating an upwind source area, and helping communities prioritize investigation. It is an estimate, not proof of a source or a measurement of individual pollutants.

## Dashboard

The Next.js dashboard opens directly without a login. It reads node, source, reading, event, alert, and cached-weather data from Supabase using the **public anon key**. Browser code is read-only and never queries `alert_recipients`.

### Run locally

1. Install Node.js 20.9 or later.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and public anon key:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   NEXT_PUBLIC_NODE_ID=sasolsniff-node-01
   OPEN_METEO_API_KEY=
   ```

   The Open-Meteo key is optional. `.env.local` is ignored by Git.

4. Start the development server:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`. If Supabase settings are missing, the app displays setup instructions instead of crashing.

### Dashboard modes

- **Live:** Supabase Realtime updates the dashboard, with four-second polling as a fallback.
- **Simulator:** choose `?sim=1` or use the Simulator button. Simulated readings run locally through the same fusion engine and are never written to Supabase.
- **Demo:** choose `?demo=1` to show the local demo checklist and rehearsal table.
- **Event report:** select Report on an event to open its printable report at `/report/[eventId]`.

Weather is loaded from Open-Meteo by the server route at `/api/weather` when no weather snapshot is present in the sensor fusion record.

## Backend and device

The Supabase SQL schema, weather migration, ingest function source, and demo playbook are included as supplied project files. Backend setup and firmware guidance are in [README (1).md](./README%20(1).md) and [DEMO_PLAYBOOK.md](./DEMO_PLAYBOOK.md). Apply the SQL and deploy the ingest function separately; the dashboard does not run migrations or deploy backend code.

## Prototype limitations

- The low-cost gas sensor is a response proxy and does not identify a specific chemical.
- Pollutant values displayed by the fusion model are simulated from the sensor rise.
- Candidate source locations are illustrative until replaced with verified facility data.
- Source classification and wind-cone candidates are estimates for investigation, not attribution.
- The prototype complements official monitoring stations; it does not replace calibrated equipment.

## Validation

```sh
npm run lint
npm run build
```