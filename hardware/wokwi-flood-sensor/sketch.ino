/*
  Africa Shield AI — ESP32 flood sensor (Wokwi simulation)

  Simulates the two sensors the backend's risk model actually uses —
  rainfall and river/water level — with two potentiometers standing in
  for their analog voltage output (see diagram.json for wiring). No real
  hardware exists yet; this is a Wokwi-only simulation.

  Every SEND_INTERVAL_MS, this reads both "sensors," converts the raw
  analog value into the same units the backend expects
  (rainfall_mm_24h, river_level_m — see backend/app/models/risk_model.py),
  and POSTs a JSON reading to POST /api/sensor-reading.

  Wokwi's simulated ESP32 cannot reach "localhost" on your computer — see
  the SERVER_URL comment below and hardware/wokwi-flood-sensor/README.md
  for how to point this at a real running backend.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>

// ---- WiFi ----
// "Wokwi-GUEST" is Wokwi's built-in simulated network — it gives the
// simulated ESP32 real internet access, no password needed. This only
// works inside the Wokwi simulator, not on real hardware.
const char *WIFI_SSID = "Wokwi-GUEST";
const char *WIFI_PASSWORD = "";

// ---- Backend endpoint ----
// Wokwi cannot reach "http://localhost:8000" — that address means
// "the Wokwi simulator itself," not your computer. Run the backend
// locally, expose it with a tunnel, and paste the resulting public URL
// below. Must be https:// — see the README in this folder for why
// (ngrok's free tier force-redirects plain http:// to https://, which
// this sketch doesn't follow; cloudflared's quick tunnels serve https://
// directly with no redirect, so that's the tunnel this project uses).
const char *SERVER_URL = "https://canvas-examination-writes-initially.trycloudflare.com/api/sensor-reading";

// Must match a "device_id" already registered in
// backend/app/data/devices.json, so the backend knows which region this
// device's readings belong to.
const char *DEVICE_ID = "esp32-demo-01";

// Must match that same device's "device_key" in devices.json — the
// backend rejects a reading (401) if this doesn't match, so a spoofed
// reading can't be sent just by knowing (or guessing) DEVICE_ID. This is
// the shared demo device's key, intentionally public here for anyone
// running this simulation — generate a fresh one
// (python -c "import secrets; print(secrets.token_hex(16))") and keep it
// out of version control for a real, non-demo device.
const char *DEVICE_KEY = "4b6f310ce39fe80edc96aea8dce01438";

// ---- Analog input pins ----
// GPIO34/GPIO35 are input-only ADC pins on the ESP32 — safe choices that
// don't conflict with WiFi or other onboard peripherals.
const int RAIN_SENSOR_PIN = 34;  // stands in for the YL-83/FC-37 rain sensor
const int WATER_LEVEL_PIN = 35;  // stands in for the water level sensor

const unsigned long SEND_INTERVAL_MS = 15000;

void connectToWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP address: ");
  Serial.println(WiFi.localIP());
}

void syncTimeFromNtp() {
  // Wokwi's simulated internet access supports NTP, so we can get a real
  // UTC time here instead of just "milliseconds since boot."
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Waiting for NTP time sync");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
}

// Formats the current time as "YYYY-MM-DDTHH:MM:SSZ", matching the
// timestamp format used everywhere else in this project's API.
String currentTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "1970-01-01T00:00:00Z";  // NTP hasn't synced yet — shouldn't happen after setup()
  }
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  connectToWiFi();
  syncTimeFromNtp();
}

void loop() {
  int rainRaw = analogRead(RAIN_SENSOR_PIN);    // ESP32 ADC: 0-4095
  int waterRaw = analogRead(WATER_LEVEL_PIN);   // ESP32 ADC: 0-4095

  // Map the raw analog reading onto the same scale the backend's risk
  // model expects: rainfall in mm over 24h (capped at 100mm) and river
  // level in meters (capped at 4m) — see risk_model.py's
  // RAINFALL_CAP_MM / RIVER_LEVEL_CAP_M.
  float rainfallMm = (rainRaw / 4095.0) * 100.0;
  float riverLevelM = (waterRaw / 4095.0) * 4.0;

  sendReading(rainfallMm, riverLevelM);
  delay(SEND_INTERVAL_MS);
}

void sendReading(float rainfallMm, float riverLevelM) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected — skipping this reading.");
    return;
  }

  // Built by hand rather than pulling in the ArduinoJson library — the
  // payload is small and fixed-shape, so a plain string keeps this
  // sketch dependency-free and easy to read.
  String payload = "{";
  payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"device_key\":\"" + String(DEVICE_KEY) + "\",";
  payload += "\"rainfall_mm_24h\":" + String(rainfallMm, 2) + ",";
  payload += "\"river_level_m\":" + String(riverLevelM, 2) + ",";
  payload += "\"timestamp\":\"" + currentTimestamp() + "\"";
  payload += "}";

  Serial.println("Sending reading: " + payload);

  // WiFiClientSecure + setInsecure(): skips TLS certificate validation.
  // Fine for this hackathon prototype hitting a throwaway tunnel URL —
  // not something to carry into a real deployment with a stable domain,
  // where the cert should actually be checked.
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  int statusCode = http.POST(payload);

  if (statusCode > 0) {
    Serial.println("Backend responded (" + String(statusCode) + "): " + http.getString());
  } else {
    Serial.println("POST failed: " + http.errorToString(statusCode));
  }
  http.end();
}
