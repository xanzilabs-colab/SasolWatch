# SasolSniff

SasolSniff is an air-quality early-warning prototype for monitoring changes in sensor response, estimating an upwind source area, and helping communities prioritize investigation. It is an estimate, not proof of a source or a measurement of individual pollutants.

## Dashboard

The Next.js dashboard opens directly without a login. It reads node, source, reading, event, alert, and cached-weather data from Supabase using the **public anon key**. Browser code is read-only and never queries `alert_recipients`.
The Leaflet map uses OpenStreetMap tiles with attribution displayed on the map; no CARTO API key is required.

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
   OPENWEATHER_API_KEY=
   ```

   Set your OpenWeather API key as `OPENWEATHER_API_KEY`. `.env.local` is ignored by Git; the key stays on the server and is never sent to the browser.

4. Start the development server:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`. If Supabase settings are missing, the app displays setup instructions instead of crashing.

### Dashboard modes

- **Live (default):** the dashboard uses ESP32 readings from Supabase Realtime and refreshes the latest values every two seconds.
- **Simulator:** click **Run scenario** and then **Start scenario**. Simulated readings stay in the browser and are never written to Supabase. A URL parameter cannot start the simulator.
- **Demo:** choose `?demo=1` to show the local demo checklist and rehearsal table.
- **Event report:** select Report on an event to open its printable report at `/report/[eventId]`.

The dashboard includes station overview, plume map, trends, events and alerts, a searchable source registry, device status, event reports, a prototype guide, and connection settings. Live mode shows the ESP32's raw MQ response and baseline, potentiometer ADC and compass direction, DHT readings, and Wi-Fi signal; event and map analysis uses the device direction. Wind speed and local weather are identified separately as OpenWeather data. This hardware does not measure individual pollutant concentrations or AQI, so live mode does not display invented values. CSV exports use the readings, events, or alert records currently loaded by the dashboard.

Weather is loaded from OpenWeather by the server route at `/api/weather` when no weather snapshot is present in the sensor fusion record. The API key remains server-side and weather never replaces the direction received from the device potentiometer. OpenWeather attribution is displayed in the dashboard; review OpenWeather's ODbL terms before redistributing stored weather data.

## Backend and device

The Supabase SQL schema, weather migration, ingest function source, demo playbook, and updated ESP32 sketch are included. Backend setup and firmware guidance are in [README (1).md](./README%20(1).md) and [DEMO_PLAYBOOK.md](./DEMO_PLAYBOOK.md). Apply the SQL and deploy the ingest function separately; the dashboard does not run migrations or deploy backend code. The sketch is in [firmware/SasolSniffNode](./firmware/SasolSniffNode); copy `secrets.example.h` to the ignored `secrets.h` and add your private Wi-Fi and device credentials locally.

Automatic WhatsApp alerts keep the full sensor analysis in the dashboard and send a separate plain-language precaution. Before a live alert is queued, the Supabase Edge Function uses the server-side `GEMI_API_KEY` secret to translate that message into Sesotho. Configure it with `supabase secrets set GEMI_API_KEY=your-key --project-ref your-project-ref`; never add it to a `NEXT_PUBLIC_` variable. If translation is unavailable, the alert falls back to the same plain-language message in English.

## Prototype limitations

- The low-cost gas sensor is a response proxy and does not identify a specific chemical.
- The MQ sensor reports a raw response proxy; it does not identify a gas or measure PM2.5, PM10, NO₂, SO₂, H₂S, CO or VOC. The local simulator may show clearly labelled fictional estimates only after it is started.
- Candidate source locations are illustrative until replaced with verified facility data.
- Source classification and wind-cone candidates are estimates for investigation, not attribution.
- The prototype complements official monitoring stations; it does not replace calibrated equipment.
- Never use a flame, lighter, butane release, smoke or aerosol near the sensor. Use only a manufacturer-approved, supervised calibration procedure.

## Validation

```sh
npm run lint
npm run build
```