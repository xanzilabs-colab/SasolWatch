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
   ```
4. In `firmware/SasolSniffNode`, copy `secrets.example.h` to `secrets.h` and enter the Wi-Fi and device credentials locally. Never commit `secrets.h`.
5. Apply the tracked WhatsApp migration and deploy the functions:
   ```
   supabase db push --project-ref bfcckzvvxqzvctvfrscd
   supabase functions deploy ingest --project-ref bfcckzvvxqzvctvfrscd --no-verify-jwt
   supabase functions deploy zernio-webhook --project-ref bfcckzvvxqzvctvfrscd --no-verify-jwt
   supabase functions deploy zernio-admin --project-ref bfcckzvvxqzvctvfrscd --no-verify-jwt
   ```

Do not send made-up readings to the deployed ingest endpoint for testing; each accepted payload is stored as a device reading and can create a real event. Use **Run scenario** in the dashboard for local-only previews.

## 1b. Local weather (OpenWeather)

- The function pulls current weather for the node's coordinates from OpenWeather and caches it in `weather_cache` for 10 minutes. If you already ran the first `schema.sql`, run `supabase/002_weather.sql` once.
- OpenWeather provides local weather context and wind speed separately. The live wind direction always comes from the device's potentiometer (`wind_from_deg`); weather can never override it. If no weather speed is available, source travel time is left unavailable rather than guessed.
- Set the server-side `OPENWEATHER_API_KEY` for the dashboard and the `OPENWEATHER_API_KEY` Supabase Edge Function secret. Keep the key out of browser code and Git. OpenWeather attribution is shown in the dashboard; review its ODbL terms before redistributing stored weather data.

## 2. WhatsApp alerts (Zernio)

- The `subscribers` table is private. People opt in by messaging `hello` or `alerts`; `STOP` and `unsubscribe` disable future alerts. Only active, opted-in subscribers are ever queued.
- Configure Supabase secrets `ZERNIO_WHATSAPP_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, and `ZERNIO_ADMIN_KEY`. Reuse the existing local `ZERNIO_WHATSAPP_API_KEY` value; do not put credentials in this repository. Keep `ALERT_DRY_RUN=true` until the WhatsApp account is connected and the template is approved.
- Webhook endpoint: `https://<app-domain>/webhooks/zernio` (the Next.js route forwards the raw request to the signed Supabase Edge Function). If the app has no public domain yet, register `https://<project-ref>.supabase.co/functions/v1/zernio-webhook` directly.
- The protected `zernio-admin` Edge Function supports `list_accounts`, `register_webhook`, `create_template`, and `send_alert` actions. Registration subscribes to `message.received`, `message.failed`, `account.disconnected`, and `whatsapp.template.status_updated`, then requests a `webhook.test`. Send the `x-admin-key` header; never expose this endpoint key in browser code.
- Call the admin endpoint at `https://<project-ref>.supabase.co/functions/v1/zernio-admin` with JSON such as `{"action":"list_accounts"}` or `{"action":"register_webhook","publicUrl":"https://<app-domain>/webhooks/zernio"}`. Use `{"action":"create_template","accountId":"<connected-account-id>"}` after confirming the WhatsApp account is connected, and `{"action":"send_alert","text":"Test alert"}` for an opted-in test.
- Create the utility template by calling the admin action with the connected WhatsApp `accountId`. It submits `alert_notification` (`en_US`) with body `SasolSniff air quality alert: {{1}}`. Meta approval is required before sends outside the 24-hour window can succeed.
- Replies and alerts use free-form text only if the subscriber's last inbound message was within 24 hours; otherwise the approved template is used. Sends are sequential, paced by six seconds, and retried at most three times with backoff. `message.failed` events record provider error codes/reasons without retry loops.
- Normal alerts are queued for active subscribers only; `ALERT_DRY_RUN=true` records previews without sending. Switch it to `false` only after account connection, template approval, and an opted-in test recipient. `ALERT_MIN_SEVERITY` (default `moderate`) and `ALERT_COOLDOWN_MIN` (default 10) control automatic alert thresholds.
- Webhook payload ids are unique-deduplicated. Message text is redacted in logs and the saved sample; private processing text is cleared after successful handling.

## 3. What the frontend reads (Supabase Realtime + anon key)

Subscribe to inserts on `readings`, and changes on `events` and `alerts`. Never read `alert_recipients` or `subscribers` from the browser.

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
