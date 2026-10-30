# SasolSniff backend (Supabase)

## 1. Deploy (about 10 minutes)

1. In the Supabase SQL editor, run `supabase/schema.sql`.
2. Install the CLI and link the project:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
3. Set secrets (pick a long random `DEVICE_KEY`, the same value goes into the firmware):
   ```
   supabase secrets set DEVICE_KEY=change-me-long-random
   supabase secrets set ALERT_DRY_RUN=true
   supabase secrets set ZERNIO_API_KEY=sk_xxx ZERNIO_ACCOUNT_ID=xxx
   supabase secrets set ZERNIO_TEMPLATE_NAME=sasolsniff_alert ZERNIO_TEMPLATE_LANG=en
   ```
4. Deploy the function (no JWT check, the device key protects it):
   ```
   supabase functions deploy ingest --no-verify-jwt
   ```
5. Firmware settings: `INGEST_URL = https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest`, `DEVICE_KEY` = the secret above.

Test without hardware:
```
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest \
  -H "x-device-key: change-me-long-random" -H "Content-Type: application/json" \
  -d '{"node_id":"sasolsniff-node-01","gas_raw":3200,"baseline_raw":1500,"wind_from_deg":330,"temperature_c":22,"humidity_pct":45}'
```
Send it twice a few seconds apart: an event opens on the second consecutive surge reading.

## 1b. Local weather (Open-Meteo, free)

- The function pulls current weather for the node's coordinates from Open-Meteo (no key needed for non-commercial use) and caches it in `weather_cache` for 10 minutes. If you already ran the first `schema.sql`, run `supabase/002_weather.sql` once.
- It uses the real wind speed for plume ETA and cone width (calm air widens the cone), and rain to reduce particle readings and open-burning likelihood. The weather and the demo vane are both shown on the dashboard so you can compare them.
- `WIND_DIR_SOURCE=device` (default) uses your potentiometer vane for wind direction, which is what you want for the demo. `WIND_DIR_SOURCE=weather` uses the real wind direction, which is how the product would run in real life.
  ```
  supabase secrets set WIND_DIR_SOURCE=device
  ```
- Open-Meteo's free tier is for non-commercial use. A commercial product needs their paid API key (`OPEN_METEO_API_KEY`). Check their terms before launch.

## 2. WhatsApp alerts (Zernio)

- `ALERT_DRY_RUN=true` logs alerts to the `alerts` table without sending. Switch to `false` only after a template is approved and a test number works.
- WhatsApp only allows free-form messages inside 24 hours of the user's last message. Outside that, it needs an **approved template**. Create this one in Zernio and wait for approval (do it today, approval time varies):

  Name: `sasolsniff_alert`, language `en`
  ```
  SasolSniff air alert for {{1}}: {{2}} pollution surge detected. Probable source: {{3}}. Wind from {{4}}. {{5}} This is an early-warning estimate, not a confirmed cause.
  ```
- The function starts the conversation with `POST https://zernio.com/api/v1/inbox/conversations` using `accountId`, `participantId` (digits only, country code included), `templateName`, `templateLanguage`, `templateParams`.
- Zernio's docs describe limits on opening new conversations (a per-sender interval and warm-up caps). I could not confirm whether they apply to WhatsApp, so test with 2 or 3 phones before the demo. Add phones in `alert_recipients`, and get their consent.
- Alerts fire when an event opens, and again if it escalates to a higher severity. `ALERT_MIN_SEVERITY` (default `moderate`) and `ALERT_COOLDOWN_MIN` (default 10) control it.

## 3. What the frontend reads (Supabase Realtime + anon key)

Subscribe to inserts on `readings`, and changes on `events` and `alerts`. Never read `alert_recipients` from the browser.

`readings.fusion` (jsonb) is the single object that drives the dashboard:

```
simulated, method
surge, severity ("none"|"low"|"moderate"|"high"|"severe"), severity_rank 0-4
intensity 0-1, rise, threshold, slope_per_s, sharpness, humidity_factor
wind: { from_deg, to_deg, compass_from, compass_to, steadiness, sector_halfwidth_deg, speed_ms, speed_assumed }
source_type, source_label, confidence, scores{industrial_plume, household_burning, traffic, open_burning}
candidates[]: { id, name, kind, lat, lon, bearing_deg, distance_km, score, eta_min, illustrative }
pollutants: { pm25, pm10, no2, so2, h2s, co, voc } each { value, unit, simulated: true }
guidance
```

Map drawing: node at `nodes.lat/lon`. Source bearing line points toward `wind.from_deg`, drawn as a cone of +/- `sector_halfwidth_deg`. The plume travels toward `wind.to_deg`. Mark candidates inside the cone. Only show source and candidates while `surge` is true.

Be honest on screen: `simulated: true` pollutants come from the real gas rise plus rules, wind speed is assumed, and `sources` are illustrative until replaced with verified facility data.

## 4. Decisions

- **GPS:** do not add a GPS module. The node does not move, indoor GPS is unreliable, and the backend already knows the position from `nodes`. Set it with `update nodes set lat=..., lon=... where id='sasolsniff-node-01';`. In the React app you can use the browser's geolocation only to centre the map on the viewer. A GPS module only makes sense later for moving nodes.
- **Button:** short press re-baselines (calibrates to clean air), long press starts a labelled test surge, so you can trigger the demo on stage even if the smoke source fails.
