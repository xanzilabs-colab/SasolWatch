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
- The project currently uses Zernio's shared WhatsApp sandbox. Discover its account and locked template with `GET https://zernio.com/api/v1/phone-numbers`; the sandbox returns `accountId`, `phoneNumber`, and `template` (`sandbox_start`, `en`). Configure Supabase secrets `USE_SANDBOX=true`, `ZERNIO_ACCOUNT_ID=<sandbox.accountId>`, `ZERNIO_SANDBOX_TEMPLATE_NAME=sandbox_start`, and `ZERNIO_SANDBOX_TEMPLATE_LANGUAGE=en`. Keep `ZERNIO_WHATSAPP_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, and `ZERNIO_ADMIN_KEY` private; reuse the existing API key and do not put credentials in Git.
- Sandbox activation is reply-based. In the protected admin endpoint, call `{"action":"activate_sandbox","phone":"+27..."}` with the one real WhatsApp phone to test. Zernio sends the locked verification template; reply to that message from the same phone, then call `{"action":"sandbox_status"}` until it returns `active`. The sandbox sender itself (+1 202 908 7457) cannot be activated as the test phone.
- Sandbox limits: one test phone per Zernio user, 50 messages and 5 distinct recipients per rolling day (normally just the one test phone), pending sessions expire after 24 hours, active sessions after 7 days. Sandbox use is free. To replace the test phone, call `{"action":"revoke_sandbox"}` first, then activate the replacement. Zernio's shared template has no variables: inside the 24-hour window alerts use free-form text; outside it, the locked generic template is sent and cannot include the alert details.
- Webhook endpoint: `https://<project-ref>.supabase.co/functions/v1/zernio-webhook` (or `https://<app-domain>/webhooks/zernio` when the Next.js app is publicly deployed). Sandbox webhook registration is scoped to the sandbox `accountId`. The handler verifies the raw-body signature, deduplicates event ids, redacts the saved inbound sample, and accepts subscription commands only from the activated sandbox test phone while sandbox mode is enabled.
- The protected admin function URL is `https://<project-ref>.supabase.co/functions/v1/zernio-admin`. Every call needs the `x-admin-key` header; never expose it in browser code. Supported actions: `discover_sandbox`, `activate_sandbox`, `sandbox_status`, `revoke_sandbox`, `list_accounts`, `register_webhook`, and `send_alert`. Registration subscribes to `message.received`, `message.failed`, `account.disconnected`, and `whatsapp.template.status_updated`, then tests delivery. `{"action":"send_alert","text":"Sandbox test","forceSend":true}` can bypass `ALERT_DRY_RUN` only in sandbox mode, and only after the one sandbox test session is active.
- `ALERT_DRY_RUN=true` is the safe default for a fresh deployment and records previews without sending. Set it to `false` only after confirming the active opt-in recipients and sandbox/production account. To exercise manual sandbox delivery, use `send_alert` with `forceSend:true`; only the configured activated test phone can be addressed. Production mode never allows that override.
- When the real WhatsApp number is connected, set `USE_SANDBOX=false`, set `ZERNIO_ACCOUNT_ID` to the real connected account id, and configure `ZERNIO_ALERT_TEMPLATE_NAME`/`ZERNIO_ALERT_TEMPLATE_LANGUAGE` to the approved production template. Re-register the webhook so its account scope changes from the sandbox id to the real account id. Create the template with `{"action":"create_template","accountId":"<real-account-id>"}`; Meta approval is required for sends outside the 24-hour window.
- Production replies and alerts use free-form text only if the subscriber's last inbound message was within 24 hours; otherwise the approved template is used. Sends are sequential, paced by six seconds, and retried at most three times with backoff. `message.failed` events record provider error codes/reasons without retry loops. A sensor event requires a score of at least 60/100 and three consecutive elevated readings; automatic WhatsApp alerts also require `ALERT_MIN_SURGE_SCORE` (default `65`), `ALERT_MIN_SEVERITY` (default `moderate`) and `ALERT_COOLDOWN_MIN` (default 10). Dry-run previews are not sent and do not suppress a later live alert.
- Webhook payload ids are unique-deduplicated. Message text is redacted in logs and the saved sample; private processing text and phone numbers are cleared after successful handling.

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
