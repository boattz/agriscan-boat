/**
 * Agriscan v2 — RS485 Soil Sensor 7-in-1 + WiFi + WebServer
 * GET /data  →  JSON สำหรับแดชบอร์ด
 *
 * v2.4.0 เพิ่ม:
 *  - คอนฟิก WiFi/Cloud ผ่านเว็บ (http://<ip>/config) เก็บใน NVS — ไม่ต้องแก้โค้ด re-flash
 *  - ถ้า WiFi เชื่อมไม่ได้ → เปิด AP "Agriscan-Config" ให้ตั้งค่าใหม่ (password: agriscan)
 *  - ส่งคลาวด์มี timeout + backoff อัตโนมัติ (3→6→12→30 วิ) — ไม่ค้างเมื่อเครือข่ายช้า
 */

#include <ModbusMaster.h>
#include <WiFi.h>
#include <WebServer.h>      // ← เพิ่ม
#include <ESPmDNS.h>        // ← เพิ่ม mDNS
#include <HTTPClient.h>     // ← ส่งข้อมูลขึ้นคลาวด์
#include <WiFiClientSecure.h>
#include <Preferences.h>    // ← เก็บ config ใน NVS (กันลืมเมื่อ restart)
#include "dashboard.h"      // ← หน้าเว็บ HTML
#include "secrets.h"        // ← ค่าเริ่มต้น WiFi + API key (ไฟล์นี้ไม่ขึ้น Git)

// ── WiFi ──────────────────────────────────────────────────
// ค่าเริ่มต้น (default) อยู่ใน secrets.h — ถ้ามีการตั้งค่าผ่านหน้า /config
// จะใช้ค่าจาก NVS แทน (ไม่ต้อง re-flash เพื่อเปลี่ยน WiFi)

// ── Cloud Upload ───────────────────────────────────────────
// URL เริ่มต้นของ backend (Render) — เปลี่ยนได้ผ่านหน้า /config
const char* DEFAULT_CLOUD_URL = "https://agriscan-v2.onrender.com/api/readings";
// API key เริ่มต้นอยู่ใน secrets.h (ดูจาก Render Dashboard → Environment → API_KEY)
// ความถี่ส่งข้อมูลขึ้นคลาวด์ (มิลลิวินาที) — 3,000 = ทุก 3 วินาที
#define POST_INTERVAL_MS   3000
#define POST_TIMEOUT_MS    5000   // ตัดการเชื่อมต่อถ้าคลาวด์ช้ากว่านี้ (กัน loop ค้าง)
#define POST_BACKOFF_MAX_MS 30000 // ถอยหลังสูงสุด 30 วิ (เมื่อเครือข่าย/คลาวด์มีปัญหา)

// ── RS485 ─────────────────────────────────────────────────
#define RXD2        16
#define TXD2        17
#define DE_RE_PIN   4       // pin ต่อ DE+RE รวมกันของ MAX485 (ไม่มีพินนี้ลบได้)
#define BAUD_RATE   4800
#define MODBUS_ID   1

ModbusMaster node;
WebServer server(80);       // ← Web Server port 80

// ── Register map ──────────────────────────────────────────
#define REG_MOISTURE     0x0000
#define REG_TEMPERATURE  0x0001
#define REG_EC           0x0002
#define REG_PH           0x0003
#define REG_NITROGEN     0x0004
#define REG_PHOSPHORUS   0x0005
#define REG_POTASSIUM    0x0006
#define REG_COUNT        7

// ── Struct ────────────────────────────────────────────────
struct SoilData {
  float moisture;
  float temperature;
  int   ec;
  float ph;
  int   nitrogen;
  int   phosphorus;
  int   potassium;
  bool  valid;
};

SoilData lastData = {0, 0, 0, 0, 0, 0, 0, false};

// ── Config (NVS) ──────────────────────────────────────────
String cfgSsid, cfgPass;       // WiFi — ค่าเริ่มต้นจาก secrets.h
String cloudUrl, apiKey;       // Cloud — ค่าเริ่มต้นจาก DEFAULT_CLOUD_URL / secrets.h
bool   cfgLoaded = false;
bool   apMode = false;         // เปิดโหมด AP (ตั้งค่า WiFi ใหม่) อยู่หรือไม่

void loadConfig() {
  Preferences prefs;
  prefs.begin("agriscan", false);
  cfgSsid    = prefs.getString("ssid", WIFI_SSID);
  cfgPass    = prefs.getString("pass", WIFI_PASS);
  cloudUrl   = prefs.getString("cloud", DEFAULT_CLOUD_URL);
  apiKey     = prefs.getString("apikey", API_KEY);
  prefs.end();
  cfgLoaded = true;
}

void saveConfig(const String& ssid, const String& pass, const String& cloud, const String& key) {
  Preferences prefs;
  prefs.begin("agriscan", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  if (!cloud.isEmpty()) prefs.putString("cloud", cloud);
  if (!key.isEmpty())   prefs.putString("apikey", key);
  prefs.end();
  // อัปเดตค่าในหน่วยความจำทันที (ไม่ต้องรอ restart)
  cfgSsid = ssid;
  cfgPass = pass;
  if (!cloud.isEmpty()) cloudUrl = cloud;
  if (!key.isEmpty())   apiKey = key;
}

void clearConfig() {
  Preferences prefs;
  prefs.begin("agriscan", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.remove("cloud");
  prefs.remove("apikey");
  prefs.end();
}

bool prefsHasConfig() {
  Preferences prefs;
  prefs.begin("agriscan", true);
  bool has = prefs.isKey("ssid") || prefs.isKey("pass") || prefs.isKey("cloud") || prefs.isKey("apikey");
  prefs.end();
  return has;
}

// ── WiFi Connect ──────────────────────────────────────────
bool connectWiFi() {
  Serial.printf("กำลังเชื่อมต่อ WiFi: %s ", cfgSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());

  uint8_t retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.printf("✅ WiFi เชื่อมต่อสำเร็จ! IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println();
  Serial.println("⚠ WiFi เชื่อมต่อไม่ได้ — เปิดโหมดตั้งค่า (AP)");
  return false;
}

void startApMode() {
  if (apMode) return;
  apMode = true;
  WiFi.mode(WIFI_AP_STA);   // AP+STA — STA ยังพยายามเชื่อมต่อคลาวด์ได้เมื่อมีเน็ต
  WiFi.softAP("Agriscan-Config", "agriscan");  // password: agriscan (8 ตัว)
  Serial.println("📶 เปิด AP 'Agriscan-Config' (password: agriscan)");
  Serial.println("   เปิด http://192.168.4.1/config เพื่อตั้งค่า WiFi/Cloud");
}

// ── อ่าน Sensor ───────────────────────────────────────────
SoilData readSensor() {
  SoilData d = {0, 0, 0, 0, 0, 0, 0, false};
  uint8_t result = node.readHoldingRegisters(REG_MOISTURE, REG_COUNT);
  Serial.printf("[Modbus] result=%d\n", result);

  if (result == node.ku8MBSuccess) {
    d.moisture    = node.getResponseBuffer(0) / 10.0;
    d.temperature = (int16_t)node.getResponseBuffer(1) / 10.0;
    d.ec          = node.getResponseBuffer(2);
    d.ph          = node.getResponseBuffer(3) / 10.0;
    d.nitrogen    = node.getResponseBuffer(4);
    d.phosphorus  = node.getResponseBuffer(5);
    d.potassium   = node.getResponseBuffer(6);
    d.valid       = true;
  }
  return d;
}

// ── Upload to Cloud (POST /api/readings) ──────────────────
// interval จะถอยหลัง (3→6→12→30 วิ) เมื่อส่งไม่สำเร็จ แล้วกลับมา 3 วิเมื่อสำเร็จ —
// กัน spam ขณะเครือข่าย/คลาวด์มีปัญหา และกัน HTTP ยาว ๆ ค้าง loop
unsigned long postIntervalMs = POST_INTERVAL_MS;

void uploadReading() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Cloud] WiFi ไม่เชื่อมต่อ — ข้ามการส่ง");
    return;
  }
  if (!lastData.valid) {
    Serial.println("[Cloud] ยังไม่มีค่าจากเซ็นเซอร์ — ข้ามการส่ง");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();   // ไม่ตรวจ certificate (เพียงพอสำหรับการทดลอง/พัฒนา)

  HTTPClient http;
  http.setTimeout(POST_TIMEOUT_MS);   // ตัดทิ้งถ้าคลาวด์ไม่ตอบกลับภายใน 5 วิ (กัน loop ค้าง)
  if (!http.begin(client, cloudUrl)) {
    Serial.println("[Cloud] เริ่ม HTTP ไม่สำเร็จ");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", apiKey);

  String body = "{";
  body += "\"moisture\":"    + String(lastData.moisture, 1)    + ",";
  body += "\"temperature\":" + String(lastData.temperature, 1) + ",";
  body += "\"ec\":"          + String(lastData.ec)             + ",";
  body += "\"ph\":"          + String(lastData.ph, 1)          + ",";
  body += "\"n\":"           + String(lastData.nitrogen)       + ",";
  body += "\"p\":"           + String(lastData.phosphorus)     + ",";
  body += "\"k\":"           + String(lastData.potassium)      + ",";
  body += "\"valid\":"       + String(lastData.valid ? "true" : "false");
  body += "}";

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[Cloud] POST %d → %s\n", code, http.getString().c_str());
    postIntervalMs = POST_INTERVAL_MS;   // สำเร็จ — กลับไปความถี่ปกติ
  } else {
    postIntervalMs = min(postIntervalMs * 2, (unsigned long)POST_BACKOFF_MAX_MS);
    Serial.printf("[Cloud] ส่งล้มเหลว (%d) — backoff ไป %lu วิ\n", code, postIntervalMs / 1000);
  }
  http.end();
}

// ── HTTP Handler: GET /data ───────────────────────────────
void handleData() {
  // CORS headers — สำคัญมาก ให้เบราว์เซอร์ดึงได้
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  String json = "{";
  json += "\"moisture\":"    + String(lastData.moisture, 1)    + ",";
  json += "\"temperature\":" + String(lastData.temperature, 1) + ",";
  json += "\"ec\":"          + String(lastData.ec)             + ",";
  json += "\"ph\":"          + String(lastData.ph, 1)          + ",";
  json += "\"n\":"           + String(lastData.nitrogen)       + ",";
  json += "\"p\":"           + String(lastData.phosphorus)     + ",";
  json += "\"k\":"           + String(lastData.potassium)      + ",";
  json += "\"valid\":"       + String(lastData.valid ? "true" : "false");
  json += "}";

  server.send(200, "application/json", json);
  Serial.println("[HTTP] GET /data → ส่ง JSON สำเร็จ");
}

// ── HTTP Handler: OPTIONS (preflight) ────────────────────
void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

// ── WiFi Config Page (http://<ip>/config) ─────────────────
// ตั้ง SSID/รหัส + Cloud URL + API key — เก็บใน NVS, restart อัตโนมัติหลังบันทึก
const char CONFIG_HTML[] = R"cfg(<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Agriscan — ตั้งค่า</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #052e16; color: #d1fae5;
         display: flex; justify-content: center; padding: 40px 16px; margin: 0; }
  .box { background: #14532d; border: 1px solid #22c55e; border-radius: 14px;
         padding: 28px; width: 100%; max-width: 420px; }
  h1 { font-size: 1.3rem; margin: 0 0 6px; color: #4ade80; }
  p  { font-size: .85rem; color: #a7f3d0; margin: 0 0 18px; }
  label { display: block; font-size: .8rem; margin: 12px 0 4px; color: #86efac; }
  input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px;
          border: 1px solid #166534; background: #052e16; color: #ecfdf5; font-size: .95rem; }
  button { width: 100%; margin-top: 20px; padding: 12px; border: 0; border-radius: 8px;
           background: #22c55e; color: #052e16; font-size: 1rem; font-weight: 700; cursor: pointer; }
  .note { font-size: .75rem; color: #86efac; margin-top: 14px; line-height: 1.5; }
  code { background: #052e16; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<form class="box" method="POST" action="/save">
  <h1>🌱 Agriscan — ตั้งค่า</h1>
  <p>ตั้งค่า WiFi และ Cloud (บันทึกแล้วเครื่องจะ restart อัตโนมัติ)</p>
  <label>ชื่อ WiFi (SSID)</label>
  <input name="ssid" required placeholder="ชื่อเครือข่าย WiFi"/>
  <label>รหัส WiFi</label>
  <input name="pass" type="password" placeholder="รหัสผ่าน WiFi"/>
  <label>Cloud URL (ไม่ต้องแก้ถ้าใช้ Render เดิม)</label>
  <input name="cloud" placeholder="https://.../api/readings"/>
  <label>API Key (ไม่ต้องแก้ถ้าใช้ค่าเดิม)</label>
  <input name="apikey" placeholder="API_KEY จาก Render"/>
  <button type="submit">บันทึกและรีสตาร์ท</button>
  <p class="note">
    สถานะ WiFi: <code id="st"></code> · IP: <code id="ip"></code><br/>
    หลังบันทึก: รอ ~15 วินาที แล้วเปิด <code>http://agriscan.local</code><br/>
    ถ้าเชื่อม WiFi ใหม่ไม่ได้อีก ให้ล้างค่าโดยกดปุ่มด้านล่าง
  </p>
  <button type="submit" formaction="/clear" style="background:#dc2626;">ล้างค่าที่ตั้งไว้ (กลับไปค่าเริ่มต้น)</button>
</form>
<script>
document.getElementById('st').textContent = 'WiFi_Conn';
document.getElementById('ip').textContent = 'WiFi_IP';
</script>
</body>
</html>
)cfg";

void handleConfig() {
  String wifiStatus = apMode ? "AP โหมดตั้งค่า (ยังไม่เชื่อม WiFi)" : "เชื่อมแล้ว";
  String html = String(CONFIG_HTML);
  html.replace("WiFi_Conn", wifiStatus);
  html.replace("WiFi_IP", WiFi.localIP().toString().c_str());
  server.send(200, "text/html; charset=utf-8", html);
}

void handleSave() {
  const String ssid  = server.arg("ssid");
  const String pass  = server.arg("pass");
  const String cloud = server.arg("cloud");
  const String key   = server.arg("apikey");

  if (ssid.isEmpty()) {
    server.send(400, "text/plain; charset=utf-8", "ต้องระบุชื่อ WiFi (SSID)");
    return;
  }

  saveConfig(ssid, pass, cloud, key);
  Serial.printf("[Config] บันทึกแล้ว: ssid=%s cloud=%s → restart\n", ssid.c_str(), cloud.c_str());

  server.send(200, "text/html; charset=utf-8",
    "<html><body style='background:#052e16;color:#d1fae5;font-family:sans-serif;padding:40px'>"
    "<h2>✅ บันทึกแล้ว — กำลังรีสตาร์ท</h2>"
    "<p>กรอกรอ ~15 วินาที แล้วเปิด <b>http://agriscan.local</b> (หรือ IP ใหม่ที่แสดงใน Serial)</p></body></html>");
  delay(2000);
  ESP.restart();
}

void handleClearConfig() {
  clearConfig();
  Serial.println("[Config] ล้างค่าที่ตั้งไว้ทั้งหมด — กลับไปค่าเริ่มต้นจาก secrets.h");
  server.send(200, "text/plain; charset=utf-8", "ล้างค่าแล้ว — กำลัง restart");
  delay(1500);
  ESP.restart();
}

// ── Print to Serial ───────────────────────────────────────
void printSerial(const SoilData& d) {
  Serial.println("┌────────────────────────────────┐");
  Serial.printf( "│ ความชื้น    : %6.1f %%\n", d.moisture);
  Serial.printf( "│ อุณหภูมิ    : %6.1f °C\n", d.temperature);
  Serial.printf( "│ EC          : %6d µS/cm\n", d.ec);
  Serial.printf( "│ pH          : %6.1f\n", d.ph);
  Serial.printf( "│ N           : %6d mg/kg\n", d.nitrogen);
  Serial.printf( "│ P           : %6d mg/kg\n", d.phosphorus);
  Serial.printf( "│ K           : %6d mg/kg\n", d.potassium);
  Serial.printf( "│ WiFi        : %s\n",
    WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "ไม่ได้เชื่อมต่อ");
  Serial.printf( "│ Cloud URL   : %s\n", cloudUrl.c_str());
  Serial.println("└────────────────────────────────┘");

  if      (d.moisture < 30) Serial.println(">> [แจ้งเตือน] ดินแห้ง — ควรรดน้ำ");
  else if (d.moisture > 80) Serial.println(">> [แจ้งเตือน] ดินชื้นเกินไป");
  else                      Serial.println(">> [OK] ความชื้นปกติ");
}

// ── Reconnect WiFi + AP fallback ──────────────────────────
// ถ้า WiFi หลุดเกิน 30 วิ → เปิด AP "Agriscan-Config" ให้ตั้งค่าใหม่
// แล้วลอง reconnect ทุก 10 วิ — พอเชื่อมได้ก็ปิด AP กลับมาปกติ
unsigned long wifiDownSince = 0;

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (apMode) {
      WiFi.softAPdisconnect(false);
      WiFi.mode(WIFI_STA);
      apMode = false;
      Serial.println("✅ เชื่อม WiFi ได้อีกครั้ง — ปิด AP แล้ว");
    }
    wifiDownSince = 0;
    return;
  }

  if (wifiDownSince == 0) wifiDownSince = millis();
  if (!apMode && millis() - wifiDownSince > 30000) startApMode();

  static unsigned long lastTry = 0;
  if (millis() - lastTry > 10000) {
    lastTry = millis();
    WiFi.disconnect();
    WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  }
}

// ── RS485 DE/RE control ────────────────────────────────
void preTransmission()  { digitalWrite(DE_RE_PIN, HIGH); }
void postTransmission() { digitalWrite(DE_RE_PIN, LOW);  }

// ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Agriscan + WiFi + WebServer ===");

  loadConfig();
  Serial.println(prefsHasConfig() ? "[Config] ใช้ค่าจาก NVS (ตั้งผ่านหน้า /config)"
                                  : "[Config] ใช้ค่าเริ่มต้นจาก secrets.h — ตั้งใหม่ได้ที่ http://<ip>/config");

  // เชื่อม WiFi — ถ้าไม่สำเร็จจะเปิด AP ให้ตั้งค่า
  bool ok = connectWiFi();
  if (!ok) startApMode();

  // ─── ตั้งชื่อ Local (mDNS) ───────────────────────────
  if (MDNS.begin("agriscan")) {
    Serial.println("✅ mDNS ทำงาน! สามารถเข้าผ่าน http://agriscan.local ได้");
  }

  // ─── ตั้ง Web Server ─────────────────────────────────
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/html", dashboard_html);
  });
  server.on("/data", HTTP_GET,     handleData);
  server.on("/data", HTTP_OPTIONS, handleOptions);
  server.on("/config", HTTP_GET,  handleConfig);
  server.on("/save",  HTTP_POST,  handleSave);
  server.on("/clear", HTTP_POST,  handleClearConfig);
  server.onNotFound([]() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(404, "text/plain", "Not found");
  });
  server.begin();
  Serial.println("🌐 Web Server เริ่มต้นแล้ว");
  Serial.printf("📡 Dashboard IP: http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("📡 หรือเข้าผ่านชื่อ: http://agriscan.local");
  Serial.println("⚙  ตั้งค่า WiFi/Cloud: http://<ip>/config\n");

  // เริ่ม RS485
  Serial2.begin(BAUD_RATE, SERIAL_8N1, RXD2, TXD2);
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW);
  node.begin(MODBUS_ID, Serial2);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);
  delay(300);
  Serial.println("พร้อมอ่านค่าเซ็นเซอร์...\n");
}

void loop() {
  server.handleClient();   // ← ต้องเรียกทุก loop เพื่อรับ HTTP request

  ensureWiFi();

  // อ่านค่า sensor ทุก 3 วินาที
  static unsigned long lastRead = 0;
  if (millis() - lastRead >= 3000) {
    lastRead = millis();

    SoilData d = readSensor();
    if (d.valid) {
      lastData = d;
      printSerial(d);
    } else {
      Serial.println("[ERROR] Modbus fail — ใช้ค่าเดิม");
    }
    Serial.println();
  }

  // ส่งค่าจริงขึ้นคลาวด์ — interval ปรับอัตโนมัติ (3 วิ ปกติ / ถอยหลัง 30 วิ เมื่อมีปัญหา)
  static unsigned long lastUpload = 0;
  if (millis() - lastUpload >= postIntervalMs) {
    lastUpload = millis();
    uploadReading();
  }
}