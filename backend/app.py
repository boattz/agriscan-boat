"""
Agriscan — Backend API (ข้อมูลจริงจาก ESP32)

รับค่าเซ็นเซอร์จริงจาก ESP32 เก็บลง PostgreSQL (หรือ SQLite เมื่อรันในเครื่อง)
และเสิร์ฟ dashboard + ค่าล่าสุดให้เว็บ

Endpoints:
  POST /api/readings  ← ESP32 ส่งค่า (ต้องมี header X-API-Key) — ตรวจเกณฑ์พืชและแจ้งเตือน Line
  GET  /api/latest    → ค่าล่าสุดจากฐานข้อมูล
  GET  /data          → alias ของ /api/latest (dashboard เดิมใช้เส้นนี้)
  GET  /api/history   → ประวัติค่าช่วงเวลา (?hours=24, downsample อัตโนมัติ)
  GET  /api/crop      → พืชที่เลือกไว้สำหรับประเมินการแจ้งเตือน
  POST /api/crop      → dashboard แจ้งชนิดพืชที่เลือก (ใช้เกณฑ์ของพืชนั้นในการแจ้งเตือน Line)
  GET  /health        → ตรวจสถานะ service + ฐานข้อมูล
  GET  /              → เสิร์ฟหน้า dashboard
"""

import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# เกณฑ์พืชรายชนิด — GENERATED จาก dashboard/crops.js (รัน: node scripts/build.js)
# ห้ามแก้ไฟล์นี้ด้วยมือ; ถ้าจะแก้เกณฑ์ ให้แก้ที่ crops.js แล้วรัน build.js
from crop_criteria import CROP_CRITERIA, DEFAULT_CROP

# ── Config ──────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DASHBOARD_DIR = os.path.join(BASE_DIR, "..", "dashboard")

# API key สำหรับกันคนอื่นส่งข้อมูลปลอม — ตั้งผ่าน env บน Render
API_KEY = os.environ.get("API_KEY", "agriscan-dev-key")

# ถ้าตั้ง DATABASE_URL (บน Render) จะใช้ PostgreSQL
# ถ้าไม่ตั้ง (รันในเครื่อง) จะใช้ SQLite file อัตโนมัติ
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# เก็บข้อมูลกี่วันแล้วลบทิ้งอัตโนมัติ (กัน database เต็ม) — ตั้งผ่าน env RETAIN_DAYS
RETAIN_DAYS = int(os.environ.get("RETAIN_DAYS", "7"))

# ทำงาน cleanup ทุกกี่ครั้งที่รับค่า (ไม่ต้องลบทุก insert — ประหยัด resource)
CLEANUP_EVERY = 50
_cleanup_counter = 0

# ── Line (Messaging API — แจ้งเตือนเมื่อค่าเกินเกณฑ์) ───────
# LINE_MESSAGING_API: LINE Notify ปิดบริการ 31 มี.ค. 2025 → ใช้ LINE Messaging API (push)
# LINE_TOKEN  = Channel Access Token (แบบ long-lived) จาก LINE Developers console
# LINE_USER_ID = ID รูปแบบ U... ของผู้รับ (ต้องแอดบอทเป็นเพื่อนก่อน) — ดึงจาก
#               GET /v2/bot/followers/ids หรือ LINE Official Account Manager
# ถ้ายังไม่ได้ตั้งครบ ระบบจะข้ามการแจ้งเตือน (log ไว้ใน console แทน)
LINE_TOKEN = os.environ.get("LINE_TOKEN", "")
LINE_USER_ID = os.environ.get("LINE_USER_ID", "")
# กันส่งซ้ำถี่เกินไป: ข้ามการแจ้งเตือนหัวข้อเดิมถ้าเพิ่งส่งไปภายในกี่นาที
LINE_COOLDOWN_MIN = int(os.environ.get("LINE_COOLDOWN_MIN", "60"))
_alert_last_sent = {}   # key (เช่น "moisture_low") -> timestamp วินาที

app = Flask(__name__)
CORS(app)

# ── Database ────────────────────────────────────────────────
if DATABASE_URL:
    import psycopg
    from psycopg.rows import dict_row

    SCHEMA = [
        """
    CREATE TABLE IF NOT EXISTS readings (
        id         SERIAL PRIMARY KEY,
        moisture   REAL,
        temperature REAL,
        ec         INTEGER,
        ph         REAL,
        n          INTEGER,
        p          INTEGER,
        k          INTEGER,
        valid      BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
        """
    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    """,
    ]
    PARAM = "%s"
else:
    SCHEMA = [
        """
    CREATE TABLE IF NOT EXISTS readings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        moisture   REAL,
        temperature REAL,
        ec         INTEGER,
        ph         REAL,
        n          INTEGER,
        p          INTEGER,
        k          INTEGER,
        valid      INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
        """
    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    """,
    ]
    PARAM = "?"


def get_conn():
    """คืน connection — PostgreSQL เมื่อมี DATABASE_URL, ไม่เช่นนั้น SQLite"""
    if DATABASE_URL:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    conn = sqlite3.connect(os.path.join(BASE_DIR, "agriscan.db"))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    try:
        with get_conn() as conn:
            for stmt in SCHEMA:   # execute รองรับแค่ 1 statement ต่อครั้ง — ต้องวนรันทีละอัน
                conn.execute(stmt)
            conn.commit()
        print("[OK] Database พร้อมใช้งาน" + (" (PostgreSQL)" if DATABASE_URL else " (SQLite local)"))
    except Exception as e:
        print("[WARN] Database init ล้มเหลว:", e)


def cleanup_old_readings():
    """ลบข้อมูลที่เก่ากว่า RETAIN_DAYS วันออก — กัน database เต็ม"""
    try:
        with get_conn() as conn:
            if DATABASE_URL:
                conn.execute(
                    "DELETE FROM readings WHERE created_at < NOW() - INTERVAL '%s days'"
                    % RETAIN_DAYS
                )
            else:
                conn.execute(
                    "DELETE FROM readings WHERE created_at < datetime('now', '-%d days')"
                    % RETAIN_DAYS
                )
            conn.commit()
        print(f"[OK] Cleanup: ลบข้อมูลเก่ากว่า {RETAIN_DAYS} วันแล้ว")
    except Exception as e:
        print("[WARN] Cleanup ล้มเหลว:", e)


def row_to_json(row):
    ts = row["created_at"]
    return {
        "moisture":    float(row["moisture"]) if row["moisture"] is not None else None,
        "temperature": float(row["temperature"]) if row["temperature"] is not None else None,
        "ec":          row["ec"],
        "ph":          float(row["ph"]) if row["ph"] is not None else None,
        "n":           row["n"],
        "p":           row["p"],
        "k":           row["k"],
        "valid":       bool(row["valid"]),
        # PostgreSQL คืน datetime ส่วน SQLite คืน string
        "timestamp":   ts.isoformat() if isinstance(ts, datetime) else ts,
    }


# ── Settings (เก็บค่าระดับระบบ เช่น พืชที่เลือก) ─────────────
def get_setting(key, default=None):
    try:
        with get_conn() as conn:
            cur = conn.execute("SELECT value FROM settings WHERE key = " + PARAM, (key,))
            row = cur.fetchone()
        return row["value"] if row is not None else default
    except Exception as e:
        print("[WARN] get_setting ล้มเหลว:", e)
        return default


def set_setting(key, value):
    try:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (" + PARAM + ", " + PARAM + ") "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )
            conn.commit()
    except Exception as e:
        print("[WARN] set_setting ล้มเหลว:", e)


# ── Line (Messaging API) ────────────────────────────────────
def line_push(message):
    """ส่งข้อความแจ้งเตือนผ่าน LINE Messaging API (POST /v2/bot/message/push)
    ใช้ Bearer token + LINE_USER_ID — ถ้ายังไม่ได้ตั้งครบจะ log แทน"""
    if not LINE_TOKEN or not LINE_USER_ID:
        print("[LINE] (ยังไม่ได้ตั้ง LINE_TOKEN / LINE_USER_ID) จะส่ง:", message.replace("\n", " "))
        return False
    body = json.dumps({
        "to": LINE_USER_ID,
        "messages": [{"type": "text", "text": message}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=body,
        headers={
            "Authorization": "Bearer " + LINE_TOKEN,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            detail = resp.read().decode("utf-8", "replace")[:200]
        if status == 200:
            print("[LINE] ส่งแจ้งเตือนสำเร็จ")
            return True
        print("[LINE] ส่งไม่สำเร็จ (HTTP %d) %s" % (status, detail))
        return False
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = e.reason
        print("[LINE] ส่งล้มเหลว (HTTP %d): %s" % (e.code, detail))
        return False
    except Exception as e:
        print("[LINE] ส่งล้มเหลว:", e)
        return False


def evaluate_alerts(row):
    """เทียบค่าล่าสุดกับเกณฑ์ของพืชที่เลือก (ค่าเดียวกับ crops.js ผ่าน crop_criteria.py)
    ส่งแจ้งเตือนผ่าน Line (Messaging API) เมื่อค่าเกินเกณฑ์ — ใช้ cooldown
    (LINE_COOLDOWN_MIN) กันสแปม"""
    if not row.get("valid"):
        return
    now = time.time()
    crop_key = get_setting("crop", DEFAULT_CROP)
    c = CROP_CRITERIA.get(crop_key, CROP_CRITERIA[DEFAULT_CROP])

    ts = datetime.now().strftime("%d/%m/%Y %H:%M")
    m, t, ph, ec = row.get("moisture"), row.get("temperature"), row.get("ph"), row.get("ec")

    heads = []   # (key, ข้อความ)
    if m is not None:
        if m < c["moisture_min"]:
            heads.append(("moisture_low", f"💧 ดินแห้งเกินไป — ความชื้น {m:.1f}% (เกณฑ์ {c['label']}: ≥{c['moisture_min']}%) ควรรดน้ำ"))
        elif m > c["moisture_max"]:
            heads.append(("moisture_high", f"🌊 ดินชื้นเกินไป — ความชื้น {m:.1f}% (เกณฑ์ {c['label']}: ≤{c['moisture_max']}%) ระวังรากเน่า"))
    if ph is not None:
        if ph < c["ph_min"]:
            heads.append(("ph_low", f"🪨 ดินเป็นกรด — pH {ph:.1f} (เกณฑ์ {c['label']}: ≥{c['ph_min']}) ควรใส่ปูนขาว/โดโลไมท์"))
        elif ph > c["ph_max"]:
            heads.append(("ph_high", f"⚗️ ดินเป็นด่าง — pH {ph:.1f} (เกณฑ์ {c['label']}: ≤{c['ph_max']}) ควรใส่กำมะถัน/ปุ๋ยอินทรีย์"))
    if ec is not None and ec > c["ec_max"] * 1000:
        heads.append(("ec_high", f"⚡ ดินเค็มเกินไป — EC {ec} µS/cm (เกณฑ์ {c['label']}: ≤{c['ec_max']} dS/m) งดปุ๋ยเคมี ล้างเกลือด้วยน้ำ"))
    if t is not None:
        if t > c["temp_max"]:
            heads.append(("temp_high", f"🌡 อุณหภูมิดินสูงเกินไป — {t:.1f}°C (เกณฑ์ {c['label']}: ≤{c['temp_max']}°C) ควรคลุมดิน"))
        elif t < c["temp_min"]:
            heads.append(("temp_low", f"❄ อุณหภูมิดินต่ำเกินไป — {t:.1f}°C (เกณฑ์ {c['label']}: ≥{c['temp_min']}°C)"))
    unit = "mg/kg"
    for f, msg in (("n", "🌿 ไนโตรเจน (N) ต่ำ"), ("p", "🌱 ฟอสฟอรัส (P) ต่ำ"), ("k", "🍂 โพแทสเซียม (K) ต่ำ")):
        v = row.get(f)
        if v is not None and v < c[f + "_low"]:
            threshold = c[f + "_low"]
            heads.append((f + "_low", f"{msg} — {f.upper()} {v} {unit} (เกณฑ์ {c['label']}: ≥{threshold} {unit})"))

    for key, msg in heads:
        last = _alert_last_sent.get(key)
        if last is not None and now - last < LINE_COOLDOWN_MIN * 60:
            continue   # ยังอยู่ใน cooldown — กันสแปมทุก 3 วิ
        _alert_last_sent[key] = now   # นับการพยายามครั้งนี้ (ทั้งส่งสำเร็จ/ไม่สำเร็จ)
        line_push(f"🌱 Agriscan — แจ้งเตือนดิน\nพืช: {c['icon']} {c['label']}\n⚠️ {msg}\nเวลา: {ts}")


# ── Routes ──────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def index():
    # เสิร์ฟ dashboard (poll /data บน origin เดียวกัน)
    return send_from_directory(DASHBOARD_DIR, "index.html")

@app.route("/<path:path>", methods=["GET"])
def static_files(path):
    # assets: style.css, script.js ฯลฯ
    return send_from_directory(DASHBOARD_DIR, path)


@app.route("/health", methods=["GET"])
def health():
    db_ok = False
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        pass
    return jsonify({"status": "healthy", "db": "connected" if db_ok else "unavailable"})


@app.route("/api/readings", methods=["POST"])
def add_reading():
    """ESP32 ส่งค่าเซ็นเซอร์จริงมาบันทึกลงฐานข้อมูล + ประเมินเกณฑ์พืช (แจ้งเตือน Line)"""
    if request.headers.get("X-API-Key") != API_KEY:
        return jsonify({"error": "unauthorized — X-API-Key ไม่ถูกต้อง"}), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "ต้องส่ง JSON body"}), 400

    fields = ["moisture", "temperature", "ec", "ph", "n", "p", "k"]
    row = {f: data.get(f) for f in fields}

    # ตรวจสอบขั้นต่ำ — ต้องมี moisture เสมอ
    if row["moisture"] is None:
        return jsonify({"error": "missing required field: moisture"}), 400

    valid = bool(data.get("valid", True))
    placeholders = ", ".join([PARAM] * (len(fields) + 1))
    sql = (
        "INSERT INTO readings (moisture, temperature, ec, ph, n, p, k, valid) "
        f"VALUES ({placeholders})"
    )

    try:
        with get_conn() as conn:
            conn.execute(sql, (*[row[f] for f in fields], valid))
            conn.commit()
    except Exception as e:
        print("⚠ Insert ล้มเหลว:", e)
        return jsonify({"error": "database error"}), 500

    # ประเมินเกณฑ์พืชของค่าล่าสุด → แจ้งเตือน Line ถ้าเกินเกณฑ์
    try:
        evaluate_alerts({**row, "valid": valid})
    except Exception as e:
        print("⚠ evaluate_alerts ล้มเหลว:", e)

    # ลบข้อมูลเก่าเป็นระยะ ๆ (ทุก CLEANUP_EVERY ครั้งที่รับค่า) — กัน DB เต็ม
    global _cleanup_counter
    _cleanup_counter += 1
    if _cleanup_counter % CLEANUP_EVERY == 0:
        cleanup_old_readings()

    return jsonify({"success": True}), 201


@app.route("/api/crop", methods=["GET"])
def crop_get():
    """พืชที่กำลังใช้เป็นเกณฑ์ประเมินการแจ้งเตือน (ตั้งโดย dashboard ผ่าน POST)"""
    key = get_setting("crop", DEFAULT_CROP)
    c = CROP_CRITERIA.get(key, CROP_CRITERIA[DEFAULT_CROP])
    return jsonify({"crop": key, "label": c["label"]})


@app.route("/api/crop", methods=["POST"])
def crop_set():
    """dashboard บอก backend ว่าผู้ใช้เลือกพืชอะไร — เกณฑ์แจ้งเตือน Line จะตามพืชนั้น"""
    data = request.get_json(silent=True) or {}
    key = str(data.get("crop", ""))
    if key not in CROP_CRITERIA:
        return jsonify({"error": f"ไม่รู้จักพืช: {key}"}), 400
    set_setting("crop", key)
    return jsonify({"crop": key, "label": CROP_CRITERIA[key]["label"]})


@app.route("/api/latest", methods=["GET"])
def latest():
    """ค่าล่าสุดจากฐานข้อมูล (ข้อมูลจริงจาก ESP32)"""
    try:
        with get_conn() as conn:
            cur = conn.execute(
                "SELECT moisture, temperature, ec, ph, n, p, k, valid, created_at "
                "FROM readings ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
    except Exception as e:
        print("⚠ Query ล้มเหลว:", e)
        return jsonify({"error": "database unavailable"}), 503

    if row is None:
        return jsonify({"error": "ยังไม่มีข้อมูล — รอ ESP32 ส่งค่ามาก่อน"}), 404

    return jsonify(row_to_json(row))


@app.route("/data", methods=["GET"])
def data():
    """alias ของ /api/latest — ใช้กับ dashboard เดิมที่ไม่ต้องแก้เส้นทาง"""
    return latest()


@app.route("/api/history", methods=["GET"])
def history():
    """ประวัติค่าจากฐานข้อมูล — ?hours=24 (default) / ?limit=500 (สูงสุด 2000)
    คืนเป็น array เรียงตามเวลา (เก่า → ใหม่) — downsample อัตโนมัติถ้าจุดข้อมูลเกิน limit"""
    try:
        hours = int(request.args.get("hours", 24))
        limit = int(request.args.get("limit", 500))
    except ValueError:
        hours, limit = 24, 500
    hours = max(1, min(hours, 24 * 30))  # 1 ชม. ถึง 30 วัน
    limit = max(10, min(limit, 2000))

    try:
        with get_conn() as conn:
            if DATABASE_URL:
                cur = conn.execute(
                    "SELECT moisture, temperature, ec, ph, n, p, k, valid, created_at "
                    "FROM readings WHERE created_at >= NOW() - INTERVAL '%s hours' "
                    "ORDER BY id ASC" % hours
                )
            else:
                cur = conn.execute(
                    "SELECT moisture, temperature, ec, ph, n, p, k, valid, created_at "
                    "FROM readings WHERE created_at >= datetime('now', '-%d hours') "
                    "ORDER BY id ASC" % hours
                )
            rows = cur.fetchall()
    except Exception as e:
        print("⚠ Query ล้มเหลว:", e)
        return jsonify({"error": "database unavailable"}), 503

    # downsample — ถ้าจุดข้อมูลเยอะเกิน limit ให้เก็บตัวอย่างกระจาย ๆ แทน
    if len(rows) > limit:
        step = len(rows) / limit
        rows = [rows[int(i * step)] for i in range(limit)]

    return jsonify([row_to_json(r) for r in rows])


init_db()
cleanup_old_readings()  # ลบทิ้งข้อมูลเก่าครั้งแรกตอน service เริ่ม

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)