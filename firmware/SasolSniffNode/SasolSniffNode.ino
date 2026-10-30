#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "DHTesp.h"
#include "secrets.h"

const char* INGEST_URL = "https://bfcckzvvxqzvctvfrscd.supabase.co/functions/v1/ingest";
const char* NODE_ID = "sasolsniff-node-01";
const char* FW_VERSION = "sasolsniff-fw-1.1";

constexpr int MQ_PIN = 34;
constexpr int WIND_PIN = 32;
constexpr int DHT_PIN = 15;
constexpr int BUTTON_PIN = 13;
constexpr int LED_PIN = 2;

constexpr unsigned long SEND_INTERVAL_MS = 1000;
constexpr unsigned long WARMUP_MS = 180000;
constexpr unsigned long DEBOUNCE_MS = 40;
constexpr unsigned long WIFI_RETRY_MS = 10000;

constexpr int WIND_RAW_MIN = 0;
constexpr int WIND_RAW_MAX = 4095;
constexpr float WIND_SPAN_DEG = 360.0f;
constexpr float WIND_OFFSET_DEG = 0.0f;
constexpr bool WIND_REVERSE = false;

constexpr float SURGE_MIN_RISE = 150.0f;
constexpr float SURGE_REL_RISE = 0.25f;

DHTesp dht;
float baseline = -1;
bool warming = true;
bool deviceSurge = false;
unsigned long bootMs = 0;
unsigned long lastSend = 0;
unsigned long lastWifiTry = 0;

int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChange = 0;
unsigned long pressStart = 0;
bool longPressHandled = false;

int flashesLeft = 0;
unsigned long nextFlash = 0;
bool flashOn = false;

void ledWrite(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

int readAnalog(int pin) {
  long total = 0;
  for (int i = 0; i < 16; i++) {
    total += analogRead(pin);
    delay(1);
  }
  return static_cast<int>(total / 16);
}

float windFromDeg(int raw) {
  const int rawSpan = WIND_RAW_MAX - WIND_RAW_MIN;
  if (rawSpan <= 0) return 0.0f;
  float fraction = constrain((raw - WIND_RAW_MIN) / static_cast<float>(rawSpan), 0.0f, 1.0f);
  if (WIND_REVERSE) fraction = 1.0f - fraction;
  float degrees = fraction * WIND_SPAN_DEG + WIND_OFFSET_DEG;
  degrees = fmodf(degrees, 360.0f);
  if (degrees < 0.0f) degrees += 360.0f;
  return degrees;
}

const char* compassDirection(float degrees) {
  static const char* points[] = {
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  };
  int index = static_cast<int>(roundf(degrees / 22.5f)) % 16;
  return points[index];
}

void startFlashes(int count) {
  flashesLeft = count * 2;
  nextFlash = millis();
  flashOn = false;
}

void rebaseline() {
  long total = 0;
  for (int i = 0; i < 30; i++) {
    total += readAnalog(MQ_PIN);
    delay(20);
  }
  baseline = total / 30.0f;
  if (warming) {
    warming = false;
    Serial.println("Warm-up ended by baseline button");
  }
  Serial.printf("BASELINE reset to %.1f\n", baseline);
  startFlashes(3);
}

void wifiConnect(bool blocking) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiTry = millis();
  if (!blocking) return;

  Serial.print("Wi-Fi connecting");
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " not connected; retrying");
}

void checkButton() {
  const int reading = digitalRead(BUTTON_PIN);
  const unsigned long now = millis();
  if (reading != lastButtonReading) {
    lastButtonChange = now;
    lastButtonReading = reading;
  }
  if (now - lastButtonChange < DEBOUNCE_MS) return;

  if (reading != stableButtonState) {
    stableButtonState = reading;
    if (stableButtonState == LOW) {
      pressStart = now;
      longPressHandled = false;
    } else if (!longPressHandled && now - pressStart >= DEBOUNCE_MS) {
      rebaseline();
    }
  }

  if (stableButtonState == LOW && !longPressHandled && now - pressStart >= 2000) {
    longPressHandled = true;
    Serial.println("Long press does not alter readings; use the dashboard simulator for demos.");
  }
}

void updateLed() {
  const unsigned long now = millis();
  if (flashesLeft > 0) {
    if (now >= nextFlash) {
      flashOn = !flashOn;
      ledWrite(flashOn);
      flashesLeft--;
      nextFlash = now + 120;
    }
    return;
  }
  if (warming) {
    ledWrite((now / 500) % 2);
  } else if (deviceSurge) {
    ledWrite(true);
  } else if (WiFi.status() != WL_CONNECTED) {
    ledWrite((now % 2000) < 80);
  } else {
    ledWrite(false);
  }
}

void sendReading() {
  const int gasRaw = readAnalog(MQ_PIN);
  const int windRaw = readAnalog(WIND_PIN);
  const float windDeg = windFromDeg(windRaw);
  const TempAndHumidity reading = dht.getTempAndHumidity();
  const bool hasTemperature = !isnan(reading.temperature) && reading.temperature >= -40 && reading.temperature <= 80;
  const bool hasHumidity = !isnan(reading.humidity) && reading.humidity >= 0 && reading.humidity <= 100;

  if (baseline < 0) baseline = static_cast<float>(gasRaw);
  if (warming && millis() - bootMs >= WARMUP_MS) {
    warming = false;
    Serial.println("Warm-up complete");
  }

  const float threshold = fmaxf(SURGE_MIN_RISE, baseline * SURGE_REL_RISE);
  deviceSurge = !warming && (gasRaw - baseline) > threshold;
  if (warming) {
    baseline = baseline * 0.8f + gasRaw * 0.2f;
  } else if (!deviceSurge) {
    baseline = baseline * 0.99f + gasRaw * 0.01f;
  }

  char temperatureJson[16];
  char humidityJson[16];
  char temperatureText[16] = "unavailable";
  char humidityText[16] = "unavailable";
  if (hasTemperature) snprintf(temperatureJson, sizeof(temperatureJson), "%.1f", reading.temperature);
  else strcpy(temperatureJson, "null");
  if (hasHumidity) snprintf(humidityJson, sizeof(humidityJson), "%.1f", reading.humidity);
  else strcpy(humidityJson, "null");
  if (hasTemperature) snprintf(temperatureText, sizeof(temperatureText), "%.1f", reading.temperature);
  if (hasHumidity) snprintf(humidityText, sizeof(humidityText), "%.1f", reading.humidity);

  char body[384];
  snprintf(body, sizeof(body),
    "{\"node_id\":\"%s\",\"gas_raw\":%d,\"baseline_raw\":%.1f,"
    "\"wind_raw\":%d,\"wind_from_deg\":%.1f,"
    "\"temperature_c\":%s,\"humidity_pct\":%s,"
    "\"device_surge\":%s,\"warming_up\":%s,\"test_mode\":false,"
    "\"rssi\":%d,\"fw\":\"%s\"}",
    NODE_ID, gasRaw, baseline, windRaw, windDeg, temperatureJson, humidityJson,
    deviceSurge ? "true" : "false", warming ? "true" : "false",
    WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0, FW_VERSION);

  Serial.printf("gas_raw=%d baseline=%.1f wind_raw=%d wind_from=%s %.1f° T=%s H=%s %s%s\n",
    gasRaw, baseline, windRaw, compassDirection(windDeg), windDeg,
    temperatureText, humidityText,
    warming ? "[WARMUP] " : "", deviceSurge ? "[SURGE]" : "");

  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(2500);
  if (!http.begin(client, INGEST_URL)) {
    Serial.println("HTTP begin failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  const int code = http.POST(reinterpret_cast<uint8_t*>(body), strlen(body));
  if (code > 0) {
    Serial.printf("POST -> %d %s\n", code, http.getString().c_str());
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  ledWrite(false);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_PIN, ADC_11db);
  analogSetPinAttenuation(WIND_PIN, ADC_11db);
  dht.setup(DHT_PIN, DHTesp::DHT11);

  Serial.println("\n=== SASOLSNIFF NODE ===");
  Serial.printf("Reporting every %lu ms. Short button press = rebaseline.\n", SEND_INTERVAL_MS);
  Serial.println("Wind direction is read from the potentiometer on GPIO 32.");

  bootMs = millis();
  wifiConnect(true);
}

void loop() {
  checkButton();
  updateLed();

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > WIFI_RETRY_MS) {
    Serial.println("Wi-Fi retry");
    WiFi.disconnect();
    wifiConnect(false);
  }

  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    sendReading();
  }
  delay(5);
}
