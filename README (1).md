# SasolSniff backend (Supabase)

## 1. Deploy (about 10 minutes)

1. In the Supabase SQL editor, run `supabase/schema.sql`.
2. Install the CLI and link the same project used by the dashboard and device:
   ```
   supabase login
   supabase link --project-ref bfcckzvvxqzvctvfrscd
   ```
3. Generate a new `DEVICE_KEY` in PowerShell, save it to the correct project, and copy it into the firmware. Keep it private:
   ```
   $bytes = New-Object byte[] 32
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
   Write-Host "Copy this value into the firmware: $key"
   supabase secrets set --project-ref bfcckzvvxqzvctvfrscd "DEVICE_KEY=$key"
   supabase secrets set --project-ref bfcckzvvxqzvctvfrscd ALERT_DRY_RUN=true
   supabase secrets set --project-ref bfcckzvvxqzvctvfrscd ZERNIO_API_KEY=YOUR_ZERNIO_API_KEY ZERNIO_ACCOUNT_ID=YOUR_ZERNIO_ACCOUNT_ID
   supabase secrets set --project-ref bfcckzvvxqzvctvfrscd ZERNIO_TEMPLATE_NAME=sasolsniff_alert ZERNIO_TEMPLATE_LANG=en
   ```
4. In `firmware/SasolSniffNode`, copy `secrets.example.h` to `secrets.h` and enter the Wi-Fi and device credentials locally. Never commit `secrets.h`.
5. Deploy the function to the linked project (the device key protects it):
   ```
   supabase functions deploy ingest --project-ref bfcckzvvxqzvctvfrscd --no-verify-jwt
   ```

Do not send made-up readings to the deployed ingest endpoint for testing; each accepted payload is stored as a device reading and can create a real event. Use **Run scenario** in the dashboard for local-only previews.

## 1b. Local weather (OpenWeather)

- The function pulls current weather for the node's coordinates from OpenWeather and caches it in `weather_cache` for 10 minutes. If you already ran the first `schema.sql`, run `supabase/002_weather.sql` once.
- OpenWeather provides local weather context and wind speed separately. The live wind direction always comes from the device's potentiometer (`wind_from_deg`); weather can never override it. If no weather speed is available, source travel time is left unavailable rather than guessed.
- Set the server-side `OPENWEATHER_API_KEY` for the dashboard and the `OPENWEATHER_API_KEY` Supabase Edge Function secret. Keep the key out of browser code and Git. OpenWeather attribution is shown in the dashboard; review its ODbL terms before redistributing stored weather data.

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

`readings.fusion` (jsonb) contains the live analysis calculated from each actual device reading:

```
simulated: false, method
surge, severity ("none"|"low"|"moderate"|"high"|"severe"), severity_rank 0-4
intensity 0-1, rise, threshold, slope_per_s, sharpness, humidity_factor
wind: { from_deg, to_deg, compass_from, compass_to, steadiness, sector_halfwidth_deg, speed_ms (or null), dir_source: "device potentiometer" }
source_type, source_label, confidence, scores{industrial_plume, household_burning, traffic, open_burning}
candidates[]: { id, name, kind, lat, lon, bearing_deg, distance_km, score, eta_min, illustrative }
guidance
```

Map drawing: node at `nodes.lat/lon`. The device potentiometer's direction is used directly for `wind.from_deg`; the plume travels toward the opposite direction. Local weather wind speed may inform the analysis, but there is no invented fallback speed or travel-time estimate. Candidate source locations remain illustrative until replaced with verified facility data. The MQ sensor is not a calibrated pollutant analyzer; live fusion does not create pollutant concentrations or AQI.

## 4. Decisions

- **GPS:** do not add a GPS module. The node does not move, indoor GPS is unreliable, and the backend already knows the position from `nodes`. Set it with `update nodes set lat=..., lon=... where id='sasolsniff-node-01';`. In the React app you can use the browser's geolocation only to centre the map on the viewer. A GPS module only makes sense later for moving nodes.
- **Button:** a short press re-baselines the gas sensor. The updated firmware does not add artificial gas spikes; use the dashboard's explicit simulator control for a local preview.
- **Wind dial:** the sketch reports raw GPIO 32 ADC counts and compass direction every second. If ADC counts barely change while turning the pot, check that its outer pins are wired to 3.3 V and GND and its wiper to GPIO 32. Set `WIND_RAW_MIN` and `WIND_RAW_MAX` to measured endpoints if your circuit does not span the ADC range.
- **Safety:** do not use a flame, lighter, butane, smoke or aerosol near the MQ sensor or electronics. Only use manufacturer-approved calibration equipment with qualified supervision.
