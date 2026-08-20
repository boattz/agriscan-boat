# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agriscan is an IoT system for real-time soil monitoring. An ESP32 reads soil sensors (moisture, temperature, EC, pH, NPK) via RS485 Modbus and serves a real-time dashboard. A Flask backend stores real readings (PostgreSQL/SQLite), serves the dashboard, and sends Line alerts (Messaging API push) when values exceed the selected crop's thresholds.

## Commands

```bash
# Backend
pip install -r backend/requirements.txt
cd backend && python app.py          # dev (port 5000)
cd backend && gunicorn app:app       # prod

# Dashboard
open dashboard/index.html            # browser, no build step

# after editing dashboard/ — regenerate generated files:
node scripts/build.js                # → esp32/agriscan/dashboard.h + backend/crop_criteria.py

# ESP32
# Flash via Arduino IDE with ModbusMaster library
```

<details>
<summary>⚠️ ไฟล์ GENERATED — ห้ามแก้ด้วยมือ</summary>

`esp32/agriscan/dashboard.h` และ `backend/crop_criteria.py` สร้างโดย `scripts/build.js`
จาก `dashboard/` (โดยเฉพาะ `crops.js` = source of truth ของเกณฑ์พืช 18 ชนิด)
— แก้ที่ `dashboard/` แล้วรัน `node scripts/build.js` เสมอ แล้ว commit ไฟล์ที่ generate ด้วย
</details>

## Architecture

```
esp32/agriscan/
  agriscan.ino          ← firmware: RS485 + WiFi + WebServer + Config Portal (NVS: /config) + AP fallback
  dashboard.h           ← embedded dashboard (GENERATED)
  secrets.h             ← ค่าเริ่มต้น WiFi/API key (ไม่ขึ้น Git)

dashboard/
  index.html            ← standalone browser dashboard
  script.js             ← polling, IP fallback chain, recommendations, ส่ง crop ขึ้นคลาวด์
  style.css             ← dark green glassmorphism theme
  crops.js              ← เกณฑ์พืช 18 ชนิด (source of truth)

scripts/
  build.js              ← generate dashboard.h + crop_criteria.py

backend/
  app.py                ← Flask: รับค่า ESP32 + DB + เสิร์ฟ dashboard + แจ้งเตือน Line (env LINE_TOKEN + LINE_USER_ID, Messaging API)
  crop_criteria.py      ← เกณฑ์พืชฝั่ง backend (GENERATED)
```

**Data flow:** ESP32 polls sensor → serves JSON at `/data` → dashboard polls every 3s;
ESP32 POSTs readings to cloud → backend stores in DB → evaluates against selected crop → Line push (Messaging API) on breach.

**Fallback chain** (in `script.js`): custom IP from localStorage → working URL → page origin → cloud (Render) → agriscan.local → 192.168.1.1 → localhost:5000.

**ESP32 is self-contained:** `dashboard.h` embeds the full dashboard HTML/CSS/JS as a C++ string literal, served directly from the microcontroller.

## Key Files

- `esp32/agriscan/agriscan.ino` — main firmware (+ Config Portal /config + AP fallback)
- `esp32/agriscan/dashboard.h` — embedded dashboard (GENERATED — อย่าแก้มือ)
- `dashboard/script.js` — client-side logic, IP management, sensor recommendations, ส่ง crop ขึ้นคลาวด์
- `dashboard/crops.js` — เกณฑ์พืช 18 ชนิด (source of truth; อย่าลืมรัน build.js หลังแก้)
- `scripts/build.js` — sync generator (dashboard.h + crop_criteria.py)
- `backend/app.py` — Flask API: รับค่า จริง + DB + แจ้งเตือน Line (Messaging API)
- `backend/crop_criteria.py` — เกณฑ์ฝั่ง backend (GENERATED)

## Dependencies

- **ESP32**: ModbusMaster (Arduino library); Preferences/WiFi/WebServer เป็นไลบรารีในตัวของ core
- **Backend**: Flask, flask-cors, gunicorn, psycopg — แจ้งเตือน Line ใช้ stdlib (urllib) ไม่ต้องเพิ่ม dependency

## Conventions

- UI language: Thai
- No framework — vanilla HTML/CSS/JS for dashboard
- ESP32 uses Arduino WebServer library
- CORS is open (`*`) — intentional for local network access
- ไฟล์ GENERATED (dashboard.h / crop_criteria.py) ห้ามแก้มือ — หลังแก้ `dashboard/` รัน `node scripts/build.js`
- **Keep `agriscan-presentation.html` updated** — whenever project files, thresholds, architecture, or behavior change, sync the presentation doc (sensor table, data flow, recommendations, limitations) with the new reality.
