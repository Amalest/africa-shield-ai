/*
  Africa Shield AI — Physical Flood Response Demo (Wokwi simulation)

  Demonstrates "Detect -> Decide -> Act": reads the water level via an
  HC-SR04 ultrasonic sensor mounted above the water pointing down (a
  SHORTER measured distance means the water surface is closer to the
  sensor, i.e. a HIGHER water level), and locally decides whether to:
    - open a diversion gate (servo) — lets excess water out before it
      builds up further
    - raise a flood wall (servo) — blocks water from reaching a
      protected area
    - turn on a drainage pump (relay) — removes water that's already
      pooled
    - show status via LEDs (green = normal, red = high water)

  Deliberately standalone — no WiFi/backend call here. This demo is the
  physical-action half of the project; ../wokwi-flood-sensor/sketch.ino
  is the sensor-to-backend reporting half. A real deployed device would
  eventually do both (act locally AND report to the backend), but they're
  kept as two separate, focused demos here.

  Needs the "ESP32Servo" library — add it via Wokwi's Library Manager
  (sidebar) before running, or a plain servo.h include will fail to
  drive a servo correctly on the ESP32's PWM hardware.
*/

#include <ESP32Servo.h>

// ---- Pins ----
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
const int GATE_SERVO_PIN = 13;
const int WALL_SERVO_PIN = 12;
const int PUMP_RELAY_PIN = 14;
const int GREEN_LED_PIN = 27;
const int RED_LED_PIN = 26;

// ---- Threshold ----
// Distance (cm) from the sensor to the water surface, at/below which
// water counts as "high." Tune this to whatever your model's dimensions
// need — it's a placeholder, not a calibrated real-world value.
const float HIGH_WATER_DISTANCE_CM = 10.0;

// ---- Servo positions ----
const int GATE_CLOSED_ANGLE = 0;
const int GATE_OPEN_ANGLE = 90;
const int WALL_DOWN_ANGLE = 0;
const int WALL_UP_ANGLE = 90;

Servo gateServo;
Servo wallServo;

bool actionsActive = false;  // tracks current state so we only log/move on an actual change

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long durationUs = pulseIn(ECHO_PIN, HIGH, 30000);  // 30ms timeout ~= 5m max range
  if (durationUs == 0) {
    return -1.0;  // no echo received
  }
  return durationUs / 58.0;  // standard HC-SR04 microseconds-to-cm conversion
}

void setActions(bool active) {
  if (active == actionsActive) {
    return;  // no state change — don't spam Serial or re-command the servos every loop
  }
  actionsActive = active;

  if (active) {
    Serial.println(">>> HIGH WATER DETECTED — opening gate, raising wall, starting pump");
    gateServo.write(GATE_OPEN_ANGLE);
    wallServo.write(WALL_UP_ANGLE);
    digitalWrite(PUMP_RELAY_PIN, HIGH);
    digitalWrite(RED_LED_PIN, HIGH);
    digitalWrite(GREEN_LED_PIN, LOW);
  } else {
    Serial.println(">>> Water level normal — closing gate, lowering wall, stopping pump");
    gateServo.write(GATE_CLOSED_ANGLE);
    wallServo.write(WALL_DOWN_ANGLE);
    digitalWrite(PUMP_RELAY_PIN, LOW);
    digitalWrite(RED_LED_PIN, LOW);
    digitalWrite(GREEN_LED_PIN, HIGH);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);

  gateServo.attach(GATE_SERVO_PIN);
  wallServo.attach(WALL_SERVO_PIN);

  setActions(false);  // start in the safe/normal state
}

void loop() {
  float distanceCm = readDistanceCm();

  if (distanceCm < 0) {
    Serial.println("No echo — check sensor wiring/positioning");
    delay(500);
    return;
  }

  Serial.print("Distance to water surface: ");
  Serial.print(distanceCm);
  Serial.println(" cm");

  setActions(distanceCm <= HIGH_WATER_DISTANCE_CM);

  delay(500);
}
