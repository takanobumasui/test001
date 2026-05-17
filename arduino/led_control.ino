// 8 LEDs on digital pins 2–9
// Circuit: pin → 220Ω resistor → LED anode → LED cathode → GND
//
// Serial protocol (9600 baud, newline-terminated):
//   PC → Arduino:  "LED:N:S\n"      N=0–7, S=0 or 1
//   PC → Arduino:  "STATUS\n"
//   Arduino → PC:  "OK:N:S\n"       after LED command
//   Arduino → PC:  "STATE:s0,s1,…,s7\n"  after STATUS

const int NUM_LEDS = 8;
const int PINS[NUM_LEDS] = {2, 3, 4, 5, 6, 7, 8, 9};
int state[NUM_LEDS] = {0};

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(PINS[i], OUTPUT);
    digitalWrite(PINS[i], LOW);
  }
}

void sendState() {
  Serial.print("STATE:");
  for (int i = 0; i < NUM_LEDS; i++) {
    Serial.print(state[i]);
    if (i < NUM_LEDS - 1) Serial.print(',');
  }
  Serial.println();
}

void loop() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();

  if (line == "STATUS") {
    sendState();
    return;
  }

  if (line.startsWith("LED:")) {
    // "LED:N:S"
    int c1 = line.indexOf(':', 4);
    if (c1 < 0) return;
    int n = line.substring(4, c1).toInt();
    int s = line.substring(c1 + 1).toInt();
    if (n < 0 || n >= NUM_LEDS) return;
    state[n] = s ? 1 : 0;
    digitalWrite(PINS[n], state[n] ? HIGH : LOW);
    Serial.print("OK:");
    Serial.print(n);
    Serial.print(':');
    Serial.println(state[n]);
  }
}
