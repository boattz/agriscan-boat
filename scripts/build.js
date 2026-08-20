#!/usr/bin/env node
'use strict';

/**
 * สร้างไฟล์ที่ต้อง "ซิงค์ด้วยมือ" จาก dashboard/crops.js (source of truth เดียว):
 *
 *   1. esp32/agriscan/dashboard.h — dashboard ฝังใน ESP32 (HTML+CSS+JS รวมเป็น C++ raw string)
 *   2. backend/crop_criteria.py   — เกณฑ์พืชฝั่ง backend (ใช้ประเมินแจ้งเตือน Line ให้ตรงกับ crops.js)
 *
 * รัน:  node scripts/build.js
 * แล้ว commit ไฟล์ที่ generate ทั้ง 2 ไฟล์ด้วย
 *
 * เหตุผล: เดิมต้องคัดลอก HTML/CSS/JS เข้า dashboard.h ด้วยมือ — ตกหล่น/ล้าสมัยได้ง่าย
 * (ตอนนี้ฝังใน dashboard.h เป็น script.js เวอร์ชันเก่า ไม่มี fallback chain) ใช้สคริปต์นี้แทน
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1) รวม dashboard เป็นไฟล์เดียว (เสมือนเปิด index.html บน ESP32) ──────────
let html = read('dashboard/index.html');
const css = read('dashboard/style.css');
const cropsJs = read('dashboard/crops.js');
const scriptJs = read('dashboard/script.js');

if (/<\/script>/i.test(cropsJs + scriptJs)) {
  throw new Error('crops.js/script.js มี </script> — ฝังใน <script> ไม่ได้');
}
if (/<\/style>/i.test(css)) {
  throw new Error('style.css มี </style> — ฝังใน <style> ไม่ได้');
}

// ฝัง CSS แทน <link rel="stylesheet" href="style.css" />
const cssLink = /<link[^>]*rel="stylesheet"[^>]*href="style\.css"[^>]*\s*\/?>/;
if (!cssLink.test(html)) throw new Error('หา <link style.css> ใน index.html ไม่เจอ');
html = html.replace(cssLink, '<style>\n' + css + '\n</style>');

// ฝัง JS แทน <script src="crops.js"> + <script src="script.js">
const scriptTags = /<script src="crops\.js"><\/script>\s*<script src="script\.js"><\/script>/;
if (!scriptTags.test(html)) throw new Error('หา <script src> ใน index.html ไม่เจอ');
html = html.replace(scriptTags, '<script>\n' + cropsJs + '\n\n' + scriptJs + '\n</script>');

// ── 2) เขียน dashboard.h — เลือก delimiter ที่ไม่ชนกับเนื้อหา ────────────────
function pickDelimiter(content) {
  for (const d of ['rawliteral', 'x', 'agriscan']) {
    if (!content.includes(')"' + d) && !content.includes('R"(' + d)) return d;
  }
  throw new Error('หา C++ raw string delimiter ที่ปลอดภัยไม่ได้');
}

const delim = pickDelimiter(html);
const header = [
  '#pragma once',
  '',
  '// ⚠️ GENERATED โดย scripts/build.js — ห้ามแก้ไฟล์นี้ด้วยมือ',
  '// แก้ที่ dashboard/ (index.html, style.css, crops.js, script.js) แล้วรัน: node scripts/build.js',
  '// (เดิมต้องคัดลอกด้วยมือ — ตอนนั้นฝังเวอร์ชันเก่า: ไม่มี fallback chain/กราฟประวัติครบ)',
  '',
  'const char* dashboard_html = R"' + delim + '(' + html + ')' + delim + '";',
  ''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'esp32/agriscan/dashboard.h'), header);

// ── 3) สร้าง backend/crop_criteria.py จาก crops.js (ประเมินแจ้งเตือน Line) ─────
// โหลด CROP_CRITERIA จริงจาก crops.js ด้วย Node — ไม่ต้องลอกค่าเองให้เพี้ยน
const src = cropsJs + '\n;globalThis.__CRITERIA = CROP_CRITERIA;';
eval(src); // eslint-disable-line no-eval
const criteria = globalThis.__CRITERIA;

function pyValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') return JSON.stringify(v); // JSON string = Python string ที่ถูกต้อง (UTF-8)
  throw new Error('ค่าใน CROP_CRITERIA ไม่รองรับ: ' + typeof v);
}

function pyCrop(key, c) {
  const npk = c.npk || {};
  const fields = [
    ['label', c.label],
    ['icon', c.icon],
    ['moisture_min', c.moisture.min],
    ['moisture_max', c.moisture.max],
    ['ph_min', c.ph.min],
    ['ph_max', c.ph.max],
    ['ec_max', c.ec.max],
    ['temp_min', c.temp.min],
    ['temp_max', c.temp.max],
    ['n_low', npk.nLow],
    ['p_low', npk.pLow],
    ['k_low', npk.kLow],
  ];
  const body = fields.map(([k, v]) => `"${k}": ${pyValue(v)}`).join(', ');
  return `    ${JSON.stringify(key)}: {${body}}`;
}

const lines = Object.entries(criteria).map(([k, c]) => pyCrop(k, c));
const py = [
  '# -*- coding: utf-8 -*-',
  '# ⚠️ GENERATED โดย scripts/build.js — ห้ามแก้ไฟล์นี้ด้วยมือ',
  '# แก้เกณฑ์ที่ dashboard/crops.js แล้วรัน: node scripts/build.js',
  '# ใช้ประเมินการแจ้งเตือน Line (backend/app.py) — ค่าตรงกับ crops.js ทุกประการ',
  '',
  'CROP_CRITERIA = {',
  lines.join(',\n'),
  '}',
  '',
  'DEFAULT_CROP = "other"',
  ''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'backend/crop_criteria.py'), py);

console.log('✅ Generate เรียบร้อย:');
console.log('  esp32/agriscan/dashboard.h   (' + (html.length / 1024).toFixed(1) + ' KB, delimiter="' + delim + '")');
console.log('  backend/crop_criteria.py     (' + Object.keys(criteria).length + ' พืช)');