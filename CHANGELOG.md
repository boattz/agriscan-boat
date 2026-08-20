# Changelog — Agriscan

เวอร์ชันทั้งหมดของ Agriscan (IoT soil monitoring) — อัปเดตตามที่ edit โค้ดจริง

รูปแบบเวอร์ชัน: `MAJOR.MINOR.PATCH`
- **MAJOR** — เปลี่ยนโครงสร้าง/สถาปัตยกรรมสำคัญ
- **MINOR** — เพิ่ม feature ความสามารถใหม่
- **PATCH** — แก้บั๊ก/ปรับปรุงเล็กน้อย

---

## [2.4.2] — 2026-08-20
### Changed
- **กราฟประวัติออกแบบใหม่ให้อ่านง่าย** — จากเดิมวาด 7 เส้นปนกันในแกนเดียว (แต่ละเส้น normalize สเกลตัวเอง ไม่มีแกน y อ่านค่าจริงไม่ได้) → **เลือกดูทีละค่า** ด้วยปุ่มสลับ (ความชื้น % / อุณหภูมิ °C / EC dS/m / pH / N·P·K mg/kg): กราฟใหญ่เต็มความสูงของค่านั้น ๆ มีแกน y 5 ระดับ + หน่วยชัดเจน, เลื่อนเมาส์/แตะดูค่า + เวลารายจุด (crosshair + กล่องอ่านค่า), ค่าล่าสุดติดขอบขวา
- กราฟสูงขึ้น 250→420px (chart-wrap + canvas), ป้ายเวอร์ชัน Ⓥ 2.4.2

## [2.4.1] — 2026-08-20
### Fixed
- **แจ้งเตือน Line พังจากบริการปิดตัว** — LINE Notify ยุติบริการ 31 มี.ค. 2025 → ย้ายไป **LINE Messaging API** (`POST /v2/bot/message/push` แบบ 1:1 กับ LINE Official Account) — code เปลี่ยนจาก `line_notify()` เป็น `line_push()`, เพิ่ม env `LINE_USER_ID` (ผู้รับ push) ใน render.yaml (`sync: false`); ยังไม่ตั้ง token/user id ครบ → log แทนเหมือนเดิม
  - หมายเหตุ: แชนแนล ID / Channel Secret ของบัญชีใช้เฉพาะตรวจสอบลายเซ็น webhook — ระบบยังไม่ใช้ webhook ไม่ต้องตั้ง env

## [Unreleased]
- (งานที่ค้างยังไม่ release — ดู git log)

## [2.4.0] — 2026-08-20
### Added
- **🔔 แจ้งเตือน Line** — backend เทียบค่าล่าสุดกับเกณฑ์ของพืชที่เลือกแล้วส่ง Line (เดิมใช้ LINE Notify → เปลี่ยนเป็น LINE Messaging API ใน 2.4.1 เพราะบริการปิดตัว) — ต้องตั้ง env `LINE_TOKEN` + `LINE_USER_ID`; ไม่ตั้งจะ log แทน — มี cooldown กันสแปม (`LINE_COOLDOWN_MIN` default 60 นาที), ปรับสเกลตามพืช
  - **เกณฑ์ตรงกับ frontend ทุกประการ** — เกณฑ์พืช (crops.js) ถูก generate เป็น `backend/crop_criteria.py` โดย `scripts/build.js` — แก้ทีเดียวที่ crops.js
  - **`/api/crop` (GET/POST)** — dashboard ส่งชนิดพืชที่ผู้ใช้เลือกมาให้ backend ใช้ประเมินการแจ้งเตือน; เก็บใน table `settings` (PostgreSQL + SQLite)
- **⚙️ Config Portal บน ESP32** — หน้า `http://<ip>/config` ตั้ง WiFi (SSID/รหัส) + Cloud URL + API key เก็บใน NVS — ไม่ต้องแก้โค้ดและ re-flash ทุกครั้ง; ถ้า WiFi เชื่อมไม่ได้ ESP32 เปิด AP `Agriscan-Config` (password: `agriscan`) ให้ตั้งค่าใหม่, ปุ่มล้างค่า (/clear) กลับไปค่าเริ่มต้นจาก secrets.h
- **ESP32 ส่งคลาวด์แข็งแรงขึ้น** — `http.setTimeout(5s)` กัน loop ค้าง + backoff อัตโนมัติ 3→6→12→30 วิ เมื่อส่งไม่สำเร็จ แล้วกลับ 3 วิเมื่อสำเร็จ; WiFi หลุดเกิน 30 วิ → เปิด AP ให้ตั้งค่า แล้ว reconnect ทุก 10 วิ
- **กราฟประวัติเพิ่ม pH + N·P·K** — จากเดิม 3 ชุดข้อมูล (ความชื้น/อุณหภูมิ/EC) เป็น 7 ชุด (แต่ละชุด normalize สเกลตัวเอง) + legend ครบ
- **`scripts/build.js`** — กำจัดงาน "ซิงค์ dashboard.h ด้วยมือ": generate `esp32/agriscan/dashboard.h` (HTML+CSS+JS รวมเป็น raw string) + `backend/crop_criteria.py` จาก `dashboard/` (source of truth เดียว) — รัน: `node scripts/build.js`
- env `LINE_TOKEN` เพิ่มใน render.yaml (`sync: false` — ตั้งจาก Render Dashboard)

### Fixed
- **`dashboard.h` ล้าสมัย** — ตัวฝังเดิมเป็น script.js เวอร์ชันเก่า (ไม่มี fallback chain ครบ) — regenerate ใหม่จากสคริปต์, ตอนนี้เท่ากับ `dashboard/` ทุกประการ

## [2.3.0] — 2026-08-18
### Added
- **ระบบประวัติข้อมูล + กราฟ** — endpoint `GET /api/history` (backend/app.py) คืนค่าช่วงเวลา ?hours=24 (default, สูงสุด 30 วัน) / ?limit=500 (สูงสุด 2000), downsample อัตโนมัติ, ใช้ได้ทั้ง PostgreSQL และ SQLite
- **กราฟประวัติบน dashboard** — วาดด้วย canvas (ไม่พึ่งไลบรารี) แสดงแนวโน้มความชื้น/อุณหภูมิ/EC ย้อนหลัง เลือกช่วง 24 ชม./7 วัน, อัปเดตทุก 60 วิ, รองรับทั้ง dashboard/ และฝังใน ESP32 (dashboard.h)
- ป้ายเวอร์ชัน Ⓥ 2.3.0 (index.html + ฝัง dashboard.h)

## [2.2.0] — 2026-08-15
### Changed
- **UI ใหญ่ขึ้นอ่านง่ายทั้งระบบ** — ตัวเลขการ์ด (card-value) ~2.6→3.6rem, ฟอนต์/ป้าย/padding/gap อัปทั่ว, แถบความชื้น 8→12px, แถบ NPK 6→10px, select พืช 0.82→1rem — CSS-only ไม่เปลี่ยน logic/สี/โครงสร้าง
- **รองรับทุกขนาดหน้าจอ (Responsive)** — breakpoint 1024px (แท็บเล็ต/จอกลาง ลดสเกล) + 600px (มือถือ: การ์ด 1 คอลัมน์, crop-selector แนวตั้ง, ตัวเลข 12vw) + 380px (จอเล็กพิเศษ) — ใช้ CSS clamp ย่อ-ขยายไม่ล้น มือถือไม่ใหญ่เกิน

### Fixed
- **หยุดกะพริบทุกครั้งที่ค่าอัปเดต** — กำจัดอนิเมชัน `flash` (สีเขียววาบ) ตอนค่าจริงจากเซ็นเซอร์ไต่ทุก ~3 วิ; `setValue` เขียน DOM เฉพาะเมื่อค่าเปลี่ยน
- **คำแนะนำไม่กะพริบทั้งเซ็ต** — `rec-grid` ไม่ rewrite ใหม่ทุก 3 วิ; เทียบด้วย key ของคำแนะนำ (`type|title|desc`) → ชุดไม่เปลี่ยน = ไม่แตะ DOM; ลบ `fade-in` ออกจาก `.rec-item`
- **status chips / แถบความชื้น-NPK ไม่เขย่า** — `setChip` ข้ามถ้าข้อความ+สถานะเท่าเดิม (กันการ์ดขยับจาก text เปลี่ยนยาวทุก 3 วิ); `animateBar` ข้ามถ้า % เท่าเดิม

### Added
- ป้ายเวอร์ชัน Ⓥ 2.2.0 ที่ header (index.html + ฝัง dashboard.h)

## [2.1.0] — 2026-08-15
### Changed
- **EC กลับไปใช้เกณฑ์ความเค็ม S1 ของกรมพัฒนาที่ดิน (LDD)** เป็นเกณฑ์หลัก (ข้าว/ข้าวโพด <2, ไม้ผล/ผัก <1 dS/m) — เลิกใช้ FAO 29 เป็นเกณฑ์หลัก (คงเป็นเพียงเอกสารอ้างอิงประกอบ)
- แก้ `src`/`conf` metadata เดิมออก; ใช้หมายเหตุระบุที่มาใน `crops.js`
- ปรับ `agriscan-presentation.html` + `docs/crop-sources.md` ให้สอดคล้อง (FAO 29 = เอกสารประกอบ)

### Fixed
- **มันสำปะหลัง EC 3 → 1.0 dS/m** — ค่าเดิมสูงสุดทั้งไฟล์ ทั้งที่จริงทนเค็มต่ำ (ผิดพลาดที่สุด)
- **พุทรา `temp.max` 35 → 45°C** — เป็นไม้ผลทนร้อนสุดขั้ว (~50°C)
- คอมเมนต์อ้าง "เล่ม 28" ผิด 6 จุด (มันฝรั่ง/หอม/กระเทียม/แตงโม/ฟักทอง/ผัก) — เล่ม 28 ครอบคลุมเฉพาะไม้ผล → เปลี่ยนอ้างเอกสารวิชาการจริง

### Added
- ฉลากเวอร์ชัน Ⓥ 2.1.0 ที่ header ของ dashboard (ทั้ง index.html และฝังใน dashboard.h)
- ไฟล์ CHANGELOG.md (เริ่มบันทึกจากเวอร์ชันนี้)

## [2.0.0] — 2026-08-15
### Added
- เพิ่มชนิดพืชอีก 14 ชนิด → รวม 18 ชนิด (ลำไย ลิ้นจี่ ทุเรียน มันสำปะหลัง มันฝรั่ง หอม กระเทียม มังคุด พุทรา แตงโม ฟักทอง ผักสวนครัว ส้มโอ ฝรั่ง)
- แยกเกณฑ์แต่ละพืชเป็น `dashboard/crops.js` (จากเดิมรวมใน script.js) — มี NPK_DEFAULT, CROP_CRITERIA, NPK_BAR_MAX
- crop selector + ระบบคำแนะนำอัตโนมัติตามชนิดพืช

### Changed
- หน่วย EC แสดงเป็น **dS/m** (จากเดิม µS/cm) ทั้งใน index.html และฝังใน dashboard.h
- Refactor script.js เพื่อความอ่านง่าย (helper npkLevels, setValue early-return ฯลฯ)

## [1.0.0] — รุ่นแรกเริ่ม (ก่อน feature อื่น)
### Initial
- ระบบ Agriscan พื้นฐาน: ESP32 อ่านเซ็นเซอร์ 7-ค่า ผ่าน RS485 Modbus + WebServer
- dashboard เดี่ยว (index.html) + Flask mock backend (app.py)
- เกณฑ์พื้นฐาน 4 ชนิด (ข้าว / ข้าวโพด / ยางพารา / อื่นๆ) อ้างอิงกรมพัฒนาที่ดิน

---

## อ้างอิงงานค้าง
- (ว่าง — งานค้างก่อนหน้าทั้งหมดปิดแล้ว: ระบบประวัติ/กราฟ 2.3.0 commit เรียบร้อย, branch วิจัยเกณฑ์พืช `agents/plant-criteria-research-thai` ยุบแล้ว)
