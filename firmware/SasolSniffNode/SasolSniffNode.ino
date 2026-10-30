#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "DHTesp.h"
#include "secrets.h"

const char* INGEST_URL = "https://bfcckzvvxqzvctvfrscd.supabase.co/functions/v1/ingest";
const char* NODE_ID = "sasolsniff-node-01";
const char* FW_VERSION = "sasolsniff-fw-1.3";

constexpr int MQ_PIN = 34;
constexpr int WIND_PIN = 32;
constexpr int DHT_PIN = 15;
constexpr int BUTTON_PIN = 13;
constexpr int LED_PIN = 2;

constexpr unsigned long SAMPLE_INTERVAL_MS = 1000;
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
struct SensorReading {
  int gasRaw;
  int windRaw;
  float windDeg;
  float baseline;
  float temperature;
  float humidity;
  int rssi;
  bool hasTemperature;
  bool hasHumidity;
  bool deviceSurge;
  bool warming;
};

QueueHandle_t uploadQueue = nullptr;
float baseline = -1;
bool warming = true;
bool deviceSurge = false;
unsigned long bootMs = 0;
unsigned long lastSample = 0;
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

void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiTry = millis();
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

void sendReading(const SensorReading& sample) {
  char temperatureJson[16];
  char humidityJson[16];
  if (sample.hasTemperature) snprintf(temperatureJson, sizeof(temperatureJson), "%.1f", sample.temperature);
  else strcpy(temperatureJson, "null");
  if (sample.hasHumidity) snprintf(humidityJson, sizeof(humidityJson), "%.1f", sample.humidity);
  else strcpy(humidityJson, "null");

  char body[384];
  snprintf(body, sizeof(body),
    "{\"node_id\":\"%s\",\"gas_raw\":%d,\"baseline_raw\":%.1f,"
    "\"wind_raw\":%d,\"wind_from_deg\":%.1f,"
    "\"temperature_c\":%s,\"humidity_pct\":%s,"
    "\"device_surge\":%s,\"warming_up\":%s,\"test_mode\":false,"
    "\"rssi\":%d,\"fw\":\"%s\"}",
    NODE_ID, sample.gasRaw, sample.baseline, sample.windRaw, sample.windDeg,
    temperatureJson, humidityJson, sample.deviceSurge ? "true" : "false",
    sample.warming ? "true" : "false", sample.rssi, FW_VERSION);

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(client, INGEST_URL)) {
    Serial.println("[UPLOAD] HTTP begin failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  const int code = http.POST(reinterpret_cast<uint8_t*>(body), strlen(body));
  if (code > 0) {
    Serial.printf("[UPLOAD] POST -> %d %s\n", code, http.getString().c_str());
  } else {
    Serial.printf("[UPLOAD] POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

void uploadTask(void* parameter) {
  SensorReading sample;
  while (true) {
    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    if (xQueueReceive(uploadQueue, &sample, pdMS_TO_TICKS(250)) == pdTRUE) {
      sendReading(sample);
    }
  }
}

void sampleSensors() {
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

  char temperatureText[16] = "unavailable";
  char humidityText[16] = "unavailable";
  if (hasTemperature) snprintf(temperatureText, sizeof(temperatureText), "%.1f", reading.temperature);
  if (hasHumidity) snprintf(humidityText, sizeof(humidityText), "%.1f", reading.humidity);

  Serial.printf("gas_raw=%d baseline=%.1f wind_raw=%d wind_from=%s %.1f° T=%s H=%s %s%s\n",
    gasRaw, baseline, windRaw, compassDirection(windDeg), windDeg,
    temperatureText, humidityText,
    warming ? "[WARMUP] " : "", deviceSurge ? "[SURGE]" : "");

  if (uploadQueue != nullptr) {
    const SensorReading sample = {
      gasRaw, windRaw, windDeg, baseline, reading.temperature, reading.humidity,
      WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0,
      hasTemperature, hasHumidity, deviceSurge, warming,
    };
    xQueueOverwrite(uploadQueue, &sample);
  }
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
  Serial.printf("Sampling every %lu ms; Wi-Fi uploads run independently. Short button press = rebaseline.\n", SAMPLE_INTERVAL_MS);
  Serial.println("Wind direction is read from the potentiometer on GPIO 32.");

  bootMs = millis();
  wifiConnect();
  uploadQueue = xQueueCreate(1, sizeof(SensorReading));
  if (uploadQueue == nullptr) {
    Serial.println("ERROR: Could not create the sensor upload queue; readings will remain serial-only.");
  } else if (xTaskCreate(uploadTask, "sensor-upload", 12288, nullptr, 1, nullptr) != pdPASS) {
    vQueueDelete(uploadQueue);
    uploadQueue = nullptr;
    Serial.println("ERROR: Could not start the Wi-Fi upload task; readings will remain serial-only.");
  }
}

void loop() {
  checkButton();
  updateLed();

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > WIFI_RETRY_MS) {
    Serial.println("Wi-Fi retry");
    WiFi.disconnect();
    wifiConnect();
  }

  if (millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    sampleSensors();
  }
  delay(5);
}
