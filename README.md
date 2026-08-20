# 🌱 Agriscan

ระบบ IoT สำหรับตรวจสอบค่าดินแบบ Real-time อ่านค่าจากเซ็นเซอร์ 7-in-1 (RS485 Modbus) ผ่าน ESP32 และแสดงผลบนแดชบอร์ดเว็บ — **ESP32 ส่งค่าจริงขึ้นคลาวด์ (Render.com) เก็บลง PostgreSQL** ดูได้จากทุกที่ ไม่มี mock data

## ค่าที่วัดได้

แดชบอร์ดให้เลือก**ชนิดพืช 18 ชนิด** (ข้าว 🌾 / ข้าวโพด 🌽 / ยางพารา 🌳 / ทุเรียน 🟢 / ลำไย 🍇 / ลิ้นจี่ 🍒 / มังคุด 🟣 / มันสำปะหลัง 🌱 / มันฝรั่ง 🥔 / หอมหัวใหญ่ 🧅 / กระเทียม 🧄 / พุทรา 🍏 / แตงโม 🍉 / ฟักทอง 🎃 / ผักสวนครัว 🥬 / ส้มโอ 🍊 / ฝรั่ง 🍐 / อื่นๆ 🌿) — ระบบใช้เกณฑ์เฉพาะของพืชนั้นๆ ในการประเมิน แนะนำ และ**แจ้งเตือน Line** (จำตัวเลือกไว้ใน localStorage):

*ตารางด้านล่างเป็นตัวอย่าง 4 พืช — เกณฑ์ครบทุกชนิดอยู่ที่ `dashboard/crops.js` (source of truth เดียว)*

| เกณฑ์ (กรมพัฒนาที่ดิน) | ข้าว 🌾 | ข้าวโพด 🌽 | ยางพารา 🌳 | อื่นๆ 🌿 |
|-----------------------|---------|-----------|------------|---------|
| pH — เหมาะสูง (S1) | 5.6–7.3 | 5.1–7.3 | 5.6–6.5 | 6.0–6.5 |
| pH — ยังปลูกได้ (S2–S3) | 4.0–8.4 | 4.0–8.4 | 4.5–6.5 | 5.5–7.5 |
| EC — เหมาะสูง (S1) | < 2 dS/m (S2: 2–5, S3: 5–10) | < 2 dS/m (S2: 2–4, S3: 4–8) | < 1 dS/m (อ่อนไหวมาก) | < 2 dS/m |
| อุณหภูมิ — เหมาะสูง (S1) | 22–30°C | 24–30°C | 22–35°C | 15–35°C |
| ความชื้น (แนวทางรดน้ำ) | 60–100% (นาขังน้ำ) | 50–80% | 30–60% (ระบายน้ำดี) | 30–80% |
| N (ค่าบ่งชี้) | ≥ 50 mg/kg | ≥ 60 mg/kg | ≥ 50 mg/kg | ≥ 50 mg/kg |
| P (ตารางที่ 15) | ต่ำ <10 · ปานกลาง 10–25 · สูง >25 mg/kg (ทุกพืช) |
| K (ตารางที่ 15) | ต่ำ <60 · ปานกลาง 60–90 · สูง >90 mg/kg (ทุกพืช) |

**แหล่งอ้างอิง:** กรมพัฒนาที่ดิน — *ศักยภาพการให้ผลผลิตพืชเศรษฐกิจของชุดดินในประเทศไทย* (สำนักสำรวจและวิจัยทรัพยากรดิน): ตารางที่ 3 ข้าว / ตารางที่ 4 ข้าวโพด (ดัดแปลงจากบัณฑิตและคำรณ, 2542) · ยางพารา: *คู่มือการจำแนกความเหมาะสมของดินสำหรับพืชเศรษฐกิจ* (เอกสารวิชาการ เล่ม 28) · P/K/N: *คู่มือการวิเคราะห์ดินทางเคมี*, ตารางที่ 15 (กองสำรวจดิน, 2523): https://e-library.ldd.go.th/library/flip/bib10134f/files/basic-html/page83.html

## สถาปัตยกรรม

```
esp32/agriscan/
  agriscan.ino            ← firmware (RS485 + WiFi + WebServer + ส่งข้อมูลขึ้นคลาวด์ + Config Portal)
  dashboard.h             ← dashboard ฝังใน C++ raw string literal (GENERATED — ห้ามแก้มือ)

dashboard/
  index.html              ← dashboard สำหรับเปิดในเบราว์เซอร์
  script.js               ← logic ดึงข้อมูล, fallback chain, คำแนะนำ
  style.css               ← ธีม dark green glassmorphism
  crops.js                ← เกณฑ์พืช 18 ชนิด (source of truth)

scripts/
  build.js                ← generate dashboard.h + backend/crop_criteria.py จาก dashboard/

backend/
  app.py                  ← Flask API จริง (รับค่า + เก็บ DB + เสิร์ฟ dashboard + แจ้งเตือน Line)
  crop_criteria.py        ← เกณฑ์พืชฝั่ง backend (GENERATED — ห้ามแก้มือ)
  requirements.txt        ← Python dependencies
```

**Data flow (ข้อมูลจริง ไม่มี mock):**

```
เซ็นเซอร์ 7-in-1 → RS485 Modbus → ESP32 → POST /api/readings (HTTPS, ทุก 3 วิ — ถอยหลังเป็น 30 วิ เมื่อมีปัญหา)
                                          ↓
                              PostgreSQL (Render)
                                          ↓
              Dashboard บนเว็บ ← GET /api/latest (poll ทุก 3 วินาที)
                                          ↓
              ค่าเกินเกณฑ์ของพืชที่เลือก → แจ้งเตือน Line (Messaging API, ทันที)
```

## วิธี Deploy (Render.com) — ดูบนเว็บได้จริง

1. **Push โค้ดนี้ขึ้น GitHub** แล้วนำเข้าใน [Render.com](https://render.com) (New → Blueprint)
2. Render จะอ่าน `render.yaml` อัตโนมัติ สร้างให้ครบ: **Web Service + PostgreSQL (free tier)** + สุ่มค่า `API_KEY`
3. เปิด URL ที่ได้ เช่น `https://agriscan-v2.onrender.com/` — จะเห็นหน้า dashboard
4. คัดลอกค่า **API_KEY** จาก Render Dashboard → Environment

### ตั้งค่า ESP32 ให้ส่งค่าขึ้นคลาวด์

**วิธีที่ 1 — ผ่านหน้าเว็บ (แนะนำ):** เปิด `http://<ip-ESP32>/config` (หรือ `http://agriscan.local/config`) ตั้ง WiFi + Cloud URL + API Key → เก็บใน NVS → restart อัตโนมัติ ไม่ต้อง re-flash

**วิธีที่ 2 — แก้โค้ด:** เปิด `esp32/agriscan/agriscan.ino` แล้วแก้ `secrets.h`:

```cpp
const char* WIFI_SSID = "...";           // ใน secrets.h (ไฟล์นี้ไม่ขึ้น Git)
const char* WIFI_PASS = "...";
const char* API_KEY   = "<ค่า API_KEY จาก Render — ดูที่ Environment>";
```

- ESP32 จะ POST ค่าจริงขึ้นคลาวด์ทุก 3 วินาที (ถอยหลังเป็น 30 วินาทีอัตโนมัติเมื่อส่งล้มเหลว)
- Backend ลบข้อมูลเก่ากว่า 7 วันอัตโนมัติ (ตั้งได้ผ่าน env `RETAIN_DAYS`) — กัน database เต็ม
- ยังเสิร์ฟ dashboard ให้เครือข่ายท้องถิ่นผ่าน `http://agriscan.local` ตามเดิม

> ถ้า WiFi เชื่อมไม่ได้ ESP32 จะเปิด AP ชื่อ **Agriscan-Config** (password: `agriscan`) — ต่อ WiFi นั้น แล้วเปิด `http://192.168.4.1/config` เพื่อตั้งค่าใหม่ (มีปุ่ม "ล้างค่า" ให้กลับไปใช้ค่าเริ่มต้นจาก secrets.h)

## วิธีใช้งาน

### Backend (รันในเครื่อง — ใช้ SQLite อัตโนมัติ)

```bash
pip install -r backend/requirements.txt
cd backend && python app.py          # http://localhost:5000
```

- ไม่ต้องตั้งค่าใด ๆ — ไม่มี `DATABASE_URL` จะใช้ไฟล์ `backend/agriscan.db` (SQLite)
- ทดสอบส่งค่าเหมือน ESP32:
  ```bash
  curl -X POST http://localhost:5000/api/readings \
       -H "Content-Type: application/json" \
       -H "X-API-Key: agriscan-dev-key" \
       -d '{"moisture":45.2,"temperature":28.5,"ec":320,"ph":6.8,"n":45,"p":32,"k":89}'
  ```

### Dashboard (เบราว์เซอร์)

- เปิด `dashboard/index.html` ตรงๆ หรือเข้าผ่าน URL ของ Render
- Fallback chain: IP ตั้งเอง (localStorage) → URL ที่ใช้ได้ล่าสุด → page origin → **คลาวด์ Render** → agriscan.local → 192.168.1.1 → localhost:5000

### ESP32 (ของจริง)

1. เปิดไฟล์ `esp32/agriscan/agriscan.ino` ใน Arduino IDE
2. ติดตั้งไลบรารี ModbusMaster (WiFi/WebServer/Preferences เป็นไลบรารีในตัวของ ESP32 core)
3. Flash ไปยัง ESP32 (ตั้ง WiFi/Cloud ผ่านหน้า `http://<ip>/config` ได้เลย ไม่ต้องแก้โค้ด)

## 🔔 แจ้งเตือน Line (Messaging API)

เมื่อค่าเซ็นเซอร์เกินเกณฑ์ของ**พืชที่เลือกบน dashboard** (เช่น ดินแห้ง, pH กรด, EC เค็ม, N/P/K ต่ำ) backend จะ push ข้อความเข้า Line แบบ 1:1 กับ LINE Official Account ของคุณ:

> ⚠️ เดิมระบบใช้ **LINE Notify** — บริการปิดตัว 31 มี.ค. 2025 แล้ว → ย้ายมาใช้ **LINE Messaging API** (ฟรี ~500 ข้อความ/เดือน, เพิ่มได้ถ้าอัปเกรด)

**วิธีตั้งค่า:**

1. สร้าง **LINE Official Account** ที่ https://manager.line.biz → เปิด Messaging API → ไปที่ https://developers.line.biz ผูก channel กับบัญชีนั้น
2. ใน LINE Developers console → channel ของคุณ → แท็บ **Messaging API** → กด **Issue** สร้าง **Channel Access Token (long-lived)** → คัดลอก
3. **แอดบอทเป็น LINE friend** — LINE app → Add friends → ค้นหา LINE ID `@107pcvry` — ระบบจะส่ง push ได้เฉพาะผู้ที่แอดบอทเป็นเพื่อนแล้ว
4. หา **LINE User ID** ของคุณ:
   ```bash
   curl https://api.line.me/v2/bot/followers/ids -H "Authorization: Bearer <Channel Access Token>"
   # → {"follow":["Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"], ...}  ใช้ค่า U...
   ```
5. ตั้ง env บน Render Dashboard: **LINE_TOKEN** = Channel Access Token, **LINE_USER_ID** = `U...` (มีใน `render.yaml` → `sync: false`) — ถ้ายังไม่ตั้งครบ ระบบจะข้ามการส่งและ log แทน (ทดสอบในเครื่องได้)

ข้อควรรู้:
- **แชนแนล ID / Channel Secret ไม่ใช่สิ่งที่ระบบใช้ส่งข้อความ** — ใช้สำหรับตรวจสอบลายเซ็น webhook เท่านั้น (ระบบเรายังไม่ใช้ webhook → ไม่ต้องตั้ง)
- กันสแปม: หัวข้อแจ้งเตือนเดิมจะส่งซ้ำอีกครั้งหลังจาก **`LINE_COOLDOWN_MIN`** (default 60 นาที) — ตั้งผ่าน env ได้

> บน dashboard ให้เลือกพืชในแถบ "🌱 พืชที่ปลูก" — ระบบจะส่งให้ backend อัตโนมัติ (`POST /api/crop`) เพื่อให้เกณฑ์การแจ้งเตือนตรงกับพืชนั้น เช่น เปลี่ยนเป็นทุเรียน → ระบบเตือนเมื่อความชื้น <50% ทันที

## ซิงค์ dashboard-H / เกณฑ์ backend (หลังแก้ dashboard/)

`dashboard/` เป็น source of truth เดียว — หลังแก้ `index.html`/`style.css`/`crops.js`/`script.js` ให้รัน:

```bash
node scripts/build.js
```

จะ generate `esp32/agriscan/dashboard.h` (dashboard ฝังใน ESP32) + `backend/crop_criteria.py` (เกณฑ์แจ้งเตือน Line) ให้ตรงกันอัตโนมัติ — **ห้ามแก้ไฟล์ GENERATED ทั้ง 2 ไฟล์ด้วยมือ**

## API Endpoints

| เส้นทาง | วิธี | คำอธิบาย |
|---------|------|-----------|
| `POST /api/readings` | ESP32 | รับค่าจากเซ็นเซอร์ (ต้องมี header `X-API-Key`) |
| `GET /api/latest` | Dashboard | ค่าล่าสุดจากฐานข้อมูล |
| `GET /data` | Dashboard | alias ของ `/api/latest` |
| `GET /api/history` | Dashboard | ประวัติค่าช่วงเวลา (`?hours=24` default สูงสุด 30 วัน / `?limit=500` สูงสุด 2000) — downsample อัตโนมัติ, ใช้ได้ทั้ง PostgreSQL และ SQLite |
| `GET /api/crop` | Dashboard | พืชที่ใช้เป็นเกณฑ์ประเมินการแจ้งเตือน (default `other`) |
| `POST /api/crop` | Dashboard | dashboard แจ้งชนิดพืชที่เลือก — เกณฑ์แจ้งเตือน Line ตามพืชนั้น (`{"crop":"durian"}`) |
| `GET /health` | — | ตรวจสถานะ service + ฐานข้อมูล |
| `GET /` | — | เสิร์ฟหน้า dashboard |

## เอกสารประกอบ

- `agriscan-presentation.html` — เอกสารนำเสนอโปรเจกต์ฉบับสมบูรณ์ (เปิดในเบราว์เซอร์)
- `agriscan-code-guide.html` — คู่มืออธิบายโค้ดทุกส่วน: ภาษา, สแตก, workflow, อธิบายทีละไฟล์ (เปิดในเบราว์เซอร์)

## หมายเหตุ

- **ไม่มี mock data แล้ว** — ถ้ายังไม่มีข้อมูล หน้าเว็บจะแสดงสถานะ offline จนกว่า ESP32 จะส่งค่ามา
- บน Render free tier พื้นที่ Postgres มีจำกัด (ส่งทุก 3 วินาที ≈ 28,800 แถว/วัน + ลบข้อมูลเก่าอัตโนมัติ) เหมาะสำหรับการสาธิต
- HTTPS ของ ESP32 ใช้ `setInsecure()` — เพียงพอสำหรับการพัฒนา ถ้าต้องการความปลอดภัยสูงขึ้นควรใช้ certificate pinning
