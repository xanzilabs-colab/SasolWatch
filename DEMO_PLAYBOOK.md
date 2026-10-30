# SasolSniff live-reading guide

## What this hardware actually measures

- MQ module: raw ADC response and a device-maintained clean-air baseline. These are not ppm or a named gas concentration.
- Potentiometer on GPIO 32: raw ADC value converted to a compass direction. It reports the dial/vane position, not wind speed.
- DHT11: on-node temperature and humidity, when the sensor returns valid values.
- ESP32: Wi-Fi signal strength.

The node has no PM2.5, PM10, NO₂, SO₂, H₂S, CO or VOC analyzer. Live mode therefore shows no pollutant concentrations or AQI. OpenWeather conditions are clearly separated from the node's measurements and attributed in the dashboard. Source classification is a rule-based estimate, and source locations may be illustrative.

## Safety

Never use a lit lighter, flame, butane release, smoke, incense or aerosol near the MQ sensor or ESP32. The MQ module has a heated element and the electronics can ignite flammable vapour. For a sensor response test, use only a manufacturer-approved calibration method in a suitable, supervised environment. A fan alone does not guarantee a gas-sensor spike and may dilute the air around it.

## Check real readings

1. Copy `firmware/SasolSniffNode/secrets.example.h` to the ignored `secrets.h`, enter credentials locally, and upload `SasolSniffNode.ino`.
2. Allow the MQ sensor to warm up for three minutes. Set a clean-air baseline with a short button press.
3. Open the dashboard. It starts in **LIVE MODE**; the simulator does not start on page load or from a URL parameter.
4. Turn the wind potentiometer. The dashboard should show a compass point and degrees, plus the raw GPIO 32 ADC count. The sketch sends once per second; dashboard refresh is every two seconds.
5. Watch the gas raw value, baseline, temperature, humidity and Wi-Fi RSSI update from device messages. A real gas-sensor response may take time to rise and clear; it is not guaranteed by moving air.
6. During an observed surge, the map's direction, upwind sector and candidate analysis use the device potentiometer reading. The candidates remain estimates, not verified attribution.

The direction mapping assumes the pot spans `WIND_RAW_MIN` to `WIND_RAW_MAX`. If the raw count stays nearly fixed while the pot turns, check wiring: outer pins to 3.3 V and GND, wiper to GPIO 32, and common ground. Calibrate the raw endpoints only after observing the full travel. Adjust `WIND_OFFSET_DEG` or `WIND_REVERSE` if the dial orientation requires it.

## Local simulator

Click **Run scenario**, then **Start scenario** to create a clearly labelled, browser-only preview. It never writes to Supabase. Click **Exit simulator** to return to live device readings.

## Explain the result

- “These displayed values are sensor readings from the ESP32. The MQ value is a raw response, not a confirmed chemical concentration.”
- “Wind direction follows the potentiometer. Weather-service wind speed and conditions are separate data.”
- “The map and source classifier are screening estimates; this prototype cannot identify a pollutant or prove a source.”
- “Only the explicitly started dashboard simulator generates fictional preview readings.”
