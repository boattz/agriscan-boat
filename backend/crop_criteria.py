# -*- coding: utf-8 -*-
# ⚠️ GENERATED โดย scripts/build.js — ห้ามแก้ไฟล์นี้ด้วยมือ
# แก้เกณฑ์ที่ dashboard/crops.js แล้วรัน: node scripts/build.js
# ใช้ประเมินการแจ้งเตือน Line (backend/app.py) — ค่าตรงกับ crops.js ทุกประการ

CROP_CRITERIA = {
    "rice": {"label": "ข้าว", "icon": "🌾", "moisture_min": 60, "moisture_max": 100, "ph_min": 4, "ph_max": 8.4, "ec_max": 2, "temp_min": 18, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "corn": {"label": "ข้าวโพด", "icon": "🌽", "moisture_min": 50, "moisture_max": 80, "ph_min": 4, "ph_max": 8.4, "ec_max": 2, "temp_min": 16, "temp_max": 35, "n_low": 60, "p_low": 10, "k_low": 60},
    "rubber": {"label": "ยางพารา", "icon": "🌳", "moisture_min": 30, "moisture_max": 60, "ph_min": 4.5, "ph_max": 6.5, "ec_max": 1, "temp_min": 22, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "longan": {"label": "ลำไย", "icon": "🍇", "moisture_min": 30, "moisture_max": 60, "ph_min": 5, "ph_max": 6.5, "ec_max": 1, "temp_min": 18, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "lychee": {"label": "ลิ้นจี่", "icon": "🍒", "moisture_min": 40, "moisture_max": 80, "ph_min": 4.5, "ph_max": 6.5, "ec_max": 1, "temp_min": 15, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "durian": {"label": "ทุเรียน", "icon": "🟢", "moisture_min": 50, "moisture_max": 90, "ph_min": 5, "ph_max": 6.5, "ec_max": 1, "temp_min": 24, "temp_max": 33, "n_low": 50, "p_low": 10, "k_low": 60},
    "cassava": {"label": "มันสำปะหลัง", "icon": "🌱", "moisture_min": 30, "moisture_max": 70, "ph_min": 4.5, "ph_max": 7.5, "ec_max": 1, "temp_min": 20, "temp_max": 35, "n_low": 40, "p_low": 10, "k_low": 60},
    "potato": {"label": "มันฝรั่ง", "icon": "🥔", "moisture_min": 50, "moisture_max": 80, "ph_min": 5, "ph_max": 7, "ec_max": 2, "temp_min": 15, "temp_max": 28, "n_low": 50, "p_low": 10, "k_low": 70},
    "onion": {"label": "หอมหัวใหญ่", "icon": "🧅", "moisture_min": 50, "moisture_max": 85, "ph_min": 5.5, "ph_max": 7.5, "ec_max": 1, "temp_min": 13, "temp_max": 25, "n_low": 50, "p_low": 10, "k_low": 60},
    "garlic": {"label": "กระเทียม", "icon": "🧄", "moisture_min": 45, "moisture_max": 80, "ph_min": 5.5, "ph_max": 7.5, "ec_max": 1, "temp_min": 12, "temp_max": 24, "n_low": 50, "p_low": 10, "k_low": 60},
    "mangosteen": {"label": "มังคุด", "icon": "🟣", "moisture_min": 50, "moisture_max": 90, "ph_min": 5, "ph_max": 6.5, "ec_max": 1, "temp_min": 22, "temp_max": 33, "n_low": 50, "p_low": 10, "k_low": 60},
    "jujube": {"label": "พุทรา", "icon": "🍏", "moisture_min": 40, "moisture_max": 70, "ph_min": 5, "ph_max": 8, "ec_max": 2, "temp_min": 18, "temp_max": 45, "n_low": 50, "p_low": 10, "k_low": 60},
    "watermelon": {"label": "แตงโม", "icon": "🍉", "moisture_min": 50, "moisture_max": 80, "ph_min": 5, "ph_max": 7.5, "ec_max": 2, "temp_min": 20, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "pumpkin": {"label": "ฟักทอง", "icon": "🎃", "moisture_min": 40, "moisture_max": 75, "ph_min": 5.5, "ph_max": 7.5, "ec_max": 2, "temp_min": 18, "temp_max": 32, "n_low": 50, "p_low": 10, "k_low": 60},
    "vegetables": {"label": "ผักสวนครัว", "icon": "🥬", "moisture_min": 50, "moisture_max": 85, "ph_min": 5.5, "ph_max": 7.5, "ec_max": 1, "temp_min": 15, "temp_max": 32, "n_low": 50, "p_low": 10, "k_low": 60},
    "pomelo": {"label": "ส้มโอ", "icon": "🍊", "moisture_min": 40, "moisture_max": 75, "ph_min": 5, "ph_max": 6.5, "ec_max": 1, "temp_min": 20, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "guava": {"label": "ฝรั่ง", "icon": "🍐", "moisture_min": 40, "moisture_max": 75, "ph_min": 5, "ph_max": 7, "ec_max": 2, "temp_min": 20, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60},
    "other": {"label": "อื่นๆ", "icon": "🌿", "moisture_min": 30, "moisture_max": 80, "ph_min": 5.5, "ph_max": 7.5, "ec_max": 2, "temp_min": 15, "temp_max": 35, "n_low": 50, "p_low": 10, "k_low": 60}
}

DEFAULT_CROP = "other"
