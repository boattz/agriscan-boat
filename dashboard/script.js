'use strict';

// ─── Config ───────────────────────────────────────────────
const CONFIG = {
  interval:     3000,
  maxRetry:     999,
  retryDelay:   3000,
  useMockOnFail: false,   // ไม่มี mock data — แสดงข้อมูลจริงเท่านั้น
  // URL ของ backend บน Render
  cloudApiUrl:  'https://agriscan-v2.onrender.com',
  // ถ้าข้อมูลเก่ากว่านี้ (ms) ให้ถือว่า ESP32 ไม่ได้ออนไลน์อยู่ → ขึ้นสถานะ "ข้อมูลเก่า"
  staleAfter:   30000
};

// ─── เกณฑ์พืชรายชนิด อยู่ใน crops.js (NPK_DEFAULT / CROP_CRITERIA / NPK_BAR_MAX)
// ─── Crop selection ──────────────────────────────────────
const CROP_KEY = 'agriscan_crop';

function getCropKey() {
  const k = localStorage.getItem(CROP_KEY);
  return CROP_CRITERIA[k] ? k : 'other';
}

function getCrop() {
  return CROP_CRITERIA[getCropKey()];
}

function changeCrop(key) {
  if (!CROP_CRITERIA[key]) key = 'other';
  localStorage.setItem(CROP_KEY, key);
  syncCropUI();
  pushCropToCloud(key);   // บอก backend ด้วย — ใช้ประเมินการแจ้งเตือน (Line Messaging API)
  // Re-evaluate with latest data if we have it
  if (state.data) updateUI(state.data);
}

// ─── ส่งชนิดพืชที่เลือกไป backend (GET/POST /api/crop) ───
// backend เก็บ "crop ปัจจุบัน" ไว้ใช้ประเมินการแจ้งเตือน Line — ข้อมูลนี้อยู่ฝั่ง
// dashboard เท่านั้น (localStorage) backend ไม่รู้เอง
function pushCropToCloud(key) {
  let base = state.activeApiUrl || window.location.origin;
  base = String(base).replace(/\/data$/, '').replace(/\/+$/, '');
  if (!/^https?:/i.test(base)) return;   // เปิดจาก file:// — ไม่มี backend
  fetch(base + '/api/crop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ crop: key })
  }).catch(() => {});   // offline — ข้ามเงียบ ๆ
}

function syncCropUI() {
  const sel = $('crop-select');
  const tag = $('crop-badge');
  const k = getCropKey();
  const crop = CROP_CRITERIA[k];
  if (sel) sel.value = k;
  if (tag) tag.textContent = crop.icon + ' ' + crop.label;
}

// ─── State ────────────────────────────────────────────────
let state = {
  data:         null,
  online:       false,
  isMock:       false,
  retryCount:   0,
  timer:        null,
  activeApiUrl: null
};

// ─── DOM refs ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Fetch data (Dynamic IP resolution) ──────────────────
async function fetchData() {
  const candidates = [];
  
  // 1. Stored Custom IP
  const customIp = localStorage.getItem('esp32_custom_ip');
  if (customIp) {
    let cleanIp = customIp.trim();
    if (!cleanIp.startsWith('http')) cleanIp = 'http://' + cleanIp;
    if (!cleanIp.endsWith('/data')) cleanIp = cleanIp.replace(/\/+$/, '') + '/data';
    candidates.push(cleanIp);
  }

  // 2. Active Working URL
  if (state.activeApiUrl && !candidates.includes(state.activeApiUrl)) {
    candidates.push(state.activeApiUrl);
  }

  // 3. Current Host Origin (if served by ESP32 or server)
  if (window.location.protocol.startsWith('http')) {
    const originUrl = window.location.origin + '/data';
    if (!candidates.includes(originUrl)) candidates.push(originUrl);
  }

  // 4. Cloud backend บน Render (ค่าจริงจาก ESP32 ที่ส่งขึ้นคลาวด์)
  const cloudUrl = CONFIG.cloudApiUrl.replace(/\/+$/, '') + '/data';
  if (!candidates.includes(cloudUrl)) candidates.push(cloudUrl);

  // 5. Fallback mDNS & Default Gateways (ESP32 บนเครือข่ายท้องถิ่น)
  const fallbacks = ['http://agriscan.local/data', 'http://192.168.1.1/data', 'http://localhost:5000/data'];
  fallbacks.forEach(f => { if (!candidates.includes(f)) candidates.push(f); });

  let success = false;

  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const json = await res.json();

      state.activeApiUrl = url;
      state.online = true;
      state.isMock = false;
      state.retryCount = 0;
      updateUI(json);

      // ── ตรวจแหล่งข้อมูล + อายุข้อมูล (กันเข้าใจผิดว่า ESP32 ออนไลน์ทั้งที่ข้อมูลเก่า) ──
      let host = '';
      try { host = new URL(url, window.location.href).hostname; } catch (e) {}
      const isCloud = /onrender\.com/i.test(host);
      let age = null;
      if (json.timestamp) {
        const t = Date.parse(json.timestamp);
        if (!isNaN(t)) age = Date.now() - t;
      }
      const stale = age !== null && age > CONFIG.staleAfter;

      setStatus(stale ? 'stale' : 'online');
      updateSourceBadge(isCloud, stale, age);
      hideBanners();

      try {
        $('ip-badge').textContent = (host || 'agriscan.local') + ' ⚙';
      } catch (e) {}

      success = true;
      break;
    } catch (err) {
      // try next candidate
    }
  }

  if (!success) {
    state.activeApiUrl = null;
    state.online = false;
    state.retryCount++;

    setStatus('offline');
    updateSourceBadge(null, false, null);
    showBanners();
  }
}

// ─── Change IP/Host Manually ──────────────────────────────
function changeIp() {
  const current = localStorage.getItem('esp32_custom_ip') || '';
  const input = prompt('ระบุ IP Address หรือ Host ของ ESP32 (เช่น 192.168.137.100 หรือ agriscan.local):', current);
  if (input !== null) {
    const val = input.trim();
    if (val) {
      localStorage.setItem('esp32_custom_ip', val);
    } else {
      localStorage.removeItem('esp32_custom_ip');
    }
    state.activeApiUrl = null;
    fetchData();
  }
}

// ─── Update UI ────────────────────────────────────────────
function updateUI(d) {
  state.data = d;
  const crop = getCrop();
  const c = crop; // shorthand

  // Moisture
  const m = clamp(d.moisture, 0, 100);
  setValue('val-moisture', m.toFixed(1));
  animateBar('bar-moisture', m, 100);
  const barEl = $('bar-moisture');
  if (m < c.moisture.min) {
    barEl.style.setProperty('--bar-color', '#f87171');
    barEl.style.background = 'linear-gradient(90deg,#ef4444,#f87171)';
    barEl.style.boxShadow  = '0 0 8px rgba(239,68,68,0.5)';
    setChip('status-moisture', 'alert', `⚠ ดินแห้งเกินไป — ควรรดน้ำ (เกณฑ์ ${c.label}: ≥${c.moisture.min}%)`);
  } else if (m > c.moisture.max) {
    barEl.style.background = 'linear-gradient(90deg,#3b82f6,#60a5fa)';
    barEl.style.boxShadow  = '0 0 8px rgba(59,130,246,0.5)';
    setChip('status-moisture', 'warn', `💧 ชื้นเกินไป — ระวังรากเน่า (เกณฑ์ ${c.label}: ≤${c.moisture.max}%)`);
  } else {
    barEl.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)';
    barEl.style.boxShadow  = '0 0 8px rgba(34,197,94,0.5)';
    setChip('status-moisture', 'ok', `✓ ปกติ (เกณฑ์ ${c.label}: ${c.moisture.min}–${c.moisture.max}%)`);
  }

  // Temperature
  setValue('val-temperature', (+d.temperature).toFixed(1));
  if (d.temperature > c.temp.max)      setChip('status-temperature', 'alert', `🌡 ร้อนเกินไป (เกณฑ์ ${c.label}: ≤${c.temp.max}°C)`);
  else if (d.temperature < c.temp.min) setChip('status-temperature', 'warn', `❄ เย็นเกินไป (เกณฑ์ ${c.label}: ≥${c.temp.min}°C)`);
  else                                 setChip('status-temperature', 'ok', '✓ ปกติ');

  // EC — เกณฑ์กรมพัฒนาที่ดิน (1 dS/m = 1,000 µS/cm — เซ็นเซอร์อ่านเป็น µS/cm)
  const ecDsm = d.ec / 1000;
  setValue('val-ec', ecDsm.toFixed(1));
  if (ecDsm > c.ec.max)       setChip('status-ec', 'alert', `⚠ เกลือสูงเกินไป — ${c.label} เหมาะกับ EC ≤${c.ec.max} dS/m`);
  else if (ecDsm < 0)         setChip('status-ec', 'warn', '↓ EC ต่ำ');
  else                        setChip('status-ec', 'ok', `✓ ปกติ (เกณฑ์ ${c.label}: ≤${c.ec.max} dS/m)`);

  // pH — เกณฑ์กรมพัฒนาที่ดิน
  setValue('val-ph', (+d.ph).toFixed(1));
  if (d.ph < c.ph.min)            setChip('status-ph', 'alert', `⚠ กรดเกินไป (เกณฑ์ ${c.label}: pH ≥${c.ph.min})`);
  else if (d.ph > c.ph.max)       setChip('status-ph', 'warn', `⚠ ด่างเกินไป (เกณฑ์ ${c.label}: pH ≤${c.ph.max})`);
  else if (d.ph < c.ph.optMin || d.ph > c.ph.optMax) setChip('status-ph', 'warn', `ℹ พอใช้ได้ (เหมาะสุด pH ${c.ph.optMin}–${c.ph.optMax})`);
  else                            setChip('status-ph', 'ok', `✓ ปกติ (เกณฑ์ ${c.label}: pH ${c.ph.min}–${c.ph.max})`);

  // NPK — เกณฑ์กรมพัฒนาที่ดิน (ตารางที่ 15): P ต่ำ <10 / กลาง 10–25 · K ต่ำ <60 / กลาง 60–90
  // N: เป็นค่าประมาณจากเซ็นเซอร์ (กรมฯ วัด N เป็น % ไม่มีเกณฑ์ mg/kg)
  const npk = npkLevels(d, c.npk);
  setValue('val-n', Math.round(d.n) + ' <small>mg/kg</small>');
  setValue('val-p', Math.round(d.p) + ' <small>mg/kg</small>');
  setValue('val-k', Math.round(d.k) + ' <small>mg/kg</small>');
  animateBar('bar-n', d.n, NPK_BAR_MAX.n);
  animateBar('bar-p', d.p, NPK_BAR_MAX.p);
  animateBar('bar-k', d.k, NPK_BAR_MAX.k);

  if (npk.alerts.length > 0)
    setChip('status-npk', 'warn', '⚠ ' + npk.alerts.join(' / '));
  else if (npk.warns.length > 0)
    setChip('status-npk', 'warn', 'ℹ ' + npk.warns.join(' / '));
  else
    setChip('status-npk', 'ok', '✓ ปกติ');

  // Recommendations
  buildRecommendations(d, npk);

  // Timestamp — แสดงเวลาที่เซ็นเซอร์ส่งค่า (จากคลาวด์) ถ้า API ให้มา
  const ts = d.timestamp ? new Date(d.timestamp) : new Date();
  $('last-update').textContent = ts.toLocaleTimeString('th-TH');
}

// ─── จัดกลุ่มระดับ N/P/K (ใช้ร่วมกับ chip บน updateUI และการ์ดแนะนำ) ──
function npkLevels(d, npk) {
  const alerts = [], warns = [];
  if (d.n < npk.nLow)                      alerts.push('N ต่ำ');
  if (d.p < npk.pLow)                      alerts.push('P ต่ำ');
  else if (d.p < npk.pMid)                 warns.push('P ปานกลาง');
  if (d.k < npk.kLow)                      alerts.push('K ต่ำ');
  else if (d.k < npk.kMid)                 warns.push('K ปานกลาง');
  return { alerts, warns, n: d.n, p: d.p, k: d.k };
}

// ─── Build recommendations ────────────────────────────────
function buildRecommendations(d, npk) {
  const recs = [];
  const c = getCrop();
  const ph = (+d.ph).toFixed(1);
  const moist = d.moisture.toFixed(1);
  const ecDsm = (d.ec / 1000).toFixed(1);
  const n = Math.round(d.n), p = Math.round(d.p), k = Math.round(d.k);

  // Moisture ตามเกณฑ์พืชที่เลือก
  if (d.moisture < c.moisture.min) {
    recs.push({ type:'alert', icon:'💧', title:'ดินแห้ง — ควรรดน้ำ', desc:`ความชื้น ${moist}% ต่ำกว่าเกณฑ์ ${c.label} (≥${c.moisture.min}%) ควรเปิดระบบรดน้ำทันที` });
  } else if (d.moisture > c.moisture.max) {
    recs.push({ type:'warn', icon:'🌊', title:'ดินชื้นเกินไป', desc:`ความชื้น ${moist}% สูงกว่าเกณฑ์ ${c.label} (≤${c.moisture.max}%) อาจทำให้รากเน่าได้ ควรหยุดรดน้ำและปรับปรุงการระบายน้ำ` });
  } else {
    recs.push({ type:'ok', icon:'✅', title:'ความชื้นอยู่ในเกณฑ์ปกติ', desc:`ความชื้น ${moist}% อยู่ในช่วงเหมาะสมของ ${c.label} (${c.moisture.min}–${c.moisture.max}%)` });
  }

  // pH ตามเกณฑ์กรมพัฒนาที่ดินของพืช
  if (d.ph < c.ph.min) {
    recs.push({ type:'alert', icon:'🪨', title:'ดินเป็นกรดเกินไป', desc:`pH ${ph} ต่ำกว่าเกณฑ์ ${c.label} (pH ≥${c.ph.min}) ควรใส่ปูนขาว (Lime) หรือโดโลไมท์เพื่อปรับสภาพดิน` });
  } else if (d.ph > c.ph.max) {
    recs.push({ type:'warn', icon:'⚗️', title:'ดินเป็นด่างเกินไป', desc:`pH ${ph} สูงกว่าเกณฑ์ ${c.label} (pH ≤${c.ph.max}) ควรใส่กำมะถัน (Sulfur) หรือปุ๋ยอินทรีย์เพื่อลด pH` });
  } else if (d.ph < c.ph.optMin || d.ph > c.ph.optMax) {
    recs.push({ type:'warn', icon:'ℹ️', title:'pH พอใช้ได้แต่ไม่เหมาะที่สุด', desc:`pH ${ph} ยังอยู่ในช่วงที่ ${c.label} ขึ้นได้ แต่ช่วงเหมาะที่สุดคือ ${c.ph.optMin}–${c.ph.optMax}` });
  } else {
    recs.push({ type:'ok', icon:'✅', title:'pH อยู่ในเกณฑ์เหมาะสม', desc:`pH ${ph} อยู่ในช่วงเหมาะที่สุดของ ${c.label} (${c.ph.optMin}–${c.ph.optMax})` });
  }

  // เกณฑ์ P, K อ้างอิงกรมพัฒนาที่ดิน (ตารางที่ 15) · N เป็นค่าประมาณจากเซ็นเซอร์
  if (d.n < c.npk.nLow) {
    recs.push({ type:'warn', icon:'🌿', title:'ไนโตรเจน (N) ค่อนข้างต่ำ', desc:`N = ${n} mg/kg (ค่าประมาณจากเซ็นเซอร์ — กรมฯ วัด N เป็น %) ควรใส่ ${c.npk.fertN}` });
  }

  if (d.p < c.npk.pLow) {
    recs.push({ type:'alert', icon:'🌱', title:'ฟอสฟอรัส (P) ต่ำ', desc:`P = ${p} mg/kg ต่ำกว่าเกณฑ์กรมพัฒนาที่ดิน (<${c.npk.pLow}) ควรใส่ ${c.npk.fertP}` });
  } else if (d.p < c.npk.pMid) {
    recs.push({ type:'warn', icon:'🌱', title:'ฟอสฟอรัส (P) ปานกลาง', desc:`P = ${p} mg/kg ระดับปานกลาง (${c.npk.pLow}–${c.npk.pMid}) ตามเกณฑ์กรมพัฒนาที่ดิน — ยังไม่ต้องใส่ปุ๋ย` });
  }

  if (d.k < c.npk.kLow) {
    recs.push({ type:'alert', icon:'🍂', title:'โพแทสเซียม (K) ต่ำ', desc:`K = ${k} mg/kg ต่ำกว่าเกณฑ์กรมพัฒนาที่ดิน (<${c.npk.kLow}) ควรใส่ ${c.npk.fertK}` });
  } else if (d.k < c.npk.kMid) {
    recs.push({ type:'warn', icon:'🍂', title:'โพแทสเซียม (K) ปานกลาง', desc:`K = ${k} mg/kg ระดับปานกลาง (${c.npk.kLow}–${c.npk.kMid}) ตามเกณฑ์กรมพัฒนาที่ดิน — ยังไม่ต้องใส่ปุ๋ย` });
  }

  // EC ตามความทนเค็มของพืช
  if (d.ec > c.ec.max * 1000) {
    recs.push({ type:'alert', icon:'⚡', title:'ดินเค็มเกินไปสำหรับ ' + c.label, desc:`EC = ${ecDsm} dS/m เกินเกณฑ์ ${c.label} (≤${c.ec.max} dS/m) ตามกรมพัฒนาที่ดิน ควรงดใส่ปุ๋ยเคมี ล้างเกลือด้วยน้ำ หรือเลือกพันธุ์ทนเค็ม` });
  }

  if (d.temperature > c.temp.max) {
    recs.push({ type:'alert', icon:'🌡', title:'อุณหภูมิดินสูงเกินไป', desc:`${(+d.temperature).toFixed(1)}°C สูงกว่าเกณฑ์ ${c.label} (≤${c.temp.max}°C) อาจส่งผลต่อการดูดซึมของราก ควรคลุมดินเพื่อลดความร้อน` });
  }

  const grid = $('rec-grid');
  const html = recs.map(r => `
    <div class="rec-item ${r.type}">
      <span class="rec-icon">${r.icon}</span>
      <div class="rec-content">
        <div class="rec-title">${r.title}</div>
        <div class="rec-desc">${r.desc}</div>
      </div>
    </div>
  `).join('');
  // เปรียบเทียบด้วย key ของคำแนะนำ (ไม่เอาเลขสุ่มในข้อความมายุ่ง) —
  // ถ้าชุดคำแนะนำจริงไม่เปลี่ยน ก็ไม่แตะ DOM เลย (กันกระพริบ/ขยับทุก 3 วิ)
  const key = recs.map(r => `${r.type}|${r.title}|${r.desc}`).join('');
  if (grid.dataset.recs === key) return;
  grid.dataset.recs = key;
  grid.innerHTML = html;
}

// ─── Helpers ──────────────────────────────────────────────
function setValue(id, val) {
  const el = $(id);
  if (!el) return;
  const s = String(val);
  if (el.innerHTML === s) return;   // ค่าไม่เปลี่ยน — ข้ามเขียน DOM ซ้ำ (ประหยัดทุก 3 วิ)
  el.innerHTML = s;
}

function animateBar(id, val, max) {
  const el = $(id);
  if (!el) return;
  const pct = clamp((val / max) * 100, 0, 100) + '%';
  if (el.style.width === pct) return;   // % ไม่เปลี่ยน — ไม่แตะ DOM (กัน reflow ทุก 3 วิ)
  el.style.width = pct;
}

function setChip(id, type, text) {
  const el = $(id);
  if (!el) return;
  if (el.textContent === text && el.classList.contains(type)) return;   // ค่า+สถานะไม่เปลี่ยน — ไม่แตะ DOM (กันกระพริบทุก 3 วิ)
  el.className = `card-status ${type}`;
  el.textContent = text;
}

function setStatus(mode) {
  const badge = $('status-badge');
  const text  = $('status-text');
  badge.className = `status-badge ${mode}`;
  if (mode === 'online') {
    text.textContent = 'ออนไลน์';
  } else if (mode === 'stale') {
    text.textContent = 'ออนไลน์ (ข้อมูลเก่า)';
  } else if (mode === 'offline') {
    text.textContent = state.isMock ? 'ออฟไลน์ (Mock)' : 'ออฟไลน์';
  } else {
    text.textContent = 'กำลังเชื่อมต่อ...';
  }
}

// ─── แหล่งข้อมูล + อายุข้อมูล (badge แยกจากสถานะออนไลน์/ออฟไลน์) ──
// isCloud: true = คลาวด์ Render · false = ESP32 ท้องถิ่น · null = ไม่มีข้อมูล
function updateSourceBadge(isCloud, stale, age) {
  const el = $('source-badge');
  if (!el) return;

  if (isCloud === null) {
    el.className = 'source-badge';
    el.textContent = '';
    return;
  }

  const source = isCloud ? 'คลาวด์' : 'ESP32 ท้องถิ่น';
  if (stale) {
    el.className = 'source-badge stale';
    el.textContent = `🟡 ${source} · ข้อมูลเก่า ${formatAge(age)}`;
  } else {
    el.className = 'source-badge fresh';
    el.textContent = isCloud ? '☁️ คลาวด์ · ข้อมูลสด' : '🟢 ESP32 ท้องถิ่น · ข้อมูลสด';
  }
}

function formatAge(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60)      return s + ' วินาที';
  const m = Math.floor(s / 60);
  if (m < 60)      return m + ' นาที';
  const h = Math.floor(m / 60);
  if (h < 24)      return h + ' ชั่วโมง';
  return Math.floor(h / 24) + ' วัน';
}

function showBanners() {
  $('connecting-banner').classList.add('visible');
  $('retry-count').textContent = `Retry ครั้งที่ ${state.retryCount} · ทุก ${CONFIG.retryDelay/1000} วินาที`;
  if (state.isMock) $('mock-banner').classList.add('visible');
}

function hideBanners() {
  $('connecting-banner').classList.remove('visible');
  $('mock-banner').classList.remove('visible');
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ─── Manual refresh ───────────────────────────────────────
async function manualRefresh() {
  const btn = $('btn-refresh');
  btn.classList.add('spinning');
  btn.disabled = true;
  await fetchData();
  setTimeout(() => {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }, 600);
}

// ─── Auto-polling ─────────────────────────────────────────
function startPolling() {
  fetchData();
  state.timer = setInterval(fetchData, CONFIG.interval);
}

// ─── History chart (canvas — ไม่พึ่งไลบรารี) ──────────────
const HISTORY = { hours: 24, timer: null, points: [], metric: 'moisture' };

// กราฟเลือกดูทีละค่า (ปุ่มสลับด้านบน) — กราฟใหญ่เต็มความสูง อ่านง่ายกว่าแผงย่อย
const METRICS = {
  moisture:    { title: 'ความชื้น (%)', min: 0, max: 100, fmt: v => String(Math.round(v)),
                 lines: [{ key: 'moisture', color: '#4ade80' }] },
  temperature: { title: 'อุณหภูมิ (°C)', auto: true,
                 lines: [{ key: 'temperature', color: '#fb923c' }] },
  ec:          { title: 'EC (dS/m)', auto: true,
                 lines: [{ key: 'ec', color: '#22d3ee', conv: v => (v == null ? null : v / 1000) }] },
  ph:          { title: 'pH', min: 3, max: 9, fmt: v => v.toFixed(1),
                 lines: [{ key: 'ph', color: '#a855f7' }] },
  npk:         { title: 'N·P·K (mg/kg)', auto: true, zero: true,
                 lines: [
                   { key: 'n', color: '#f472b6', lbl: 'N' },
                   { key: 'p', color: '#fbbf24', lbl: 'P' },
                   { key: 'k', color: '#60a5fa', lbl: 'K' },
                 ] },
};

let lastDraw = null;   // สถานะกราฟล่าสุด — ใช้ตอน hover หาจุดใกล้สุด

function setChartMetric(m) {
  if (!METRICS[m]) return;
  HISTORY.metric = m;
  document.querySelectorAll('.metric-btn').forEach(b => b.classList.toggle('active', b.dataset.metric === m));
  hideChartEmpty();
  drawHistory();
}

function historyCandidates() {
  const out = [];
  const add = u => { if (!out.includes(u)) out.push(u); };
  if (window.location.protocol.startsWith('http')) {
    add(window.location.origin + '/api/history');
  }
  add(CONFIG.cloudApiUrl.replace(/\/+$/, '') + '/api/history');
  add('http://localhost:5000/api/history');
  return out;
}

function parseTs(s) {
  const t = Date.parse(String(s).replace(' ', 'T'));  // SQLite ส่ง "YYYY-MM-DD HH:MM:SS" — เติม T ให้ Date.parse เข้าใจ
  return isNaN(t) ? null : t;
}

function showChartEmpty(msg) {
  const el = $('chart-empty');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideChartEmpty() {
  const el = $('chart-empty');
  if (el) el.classList.add('hidden');
}

async function fetchHistory() {
  for (const url of historyCandidates()) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url + '?hours=' + HISTORY.hours, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const json = await res.json();
      if (!Array.isArray(json)) continue;
      HISTORY.points = json;
      drawHistory();
      hideChartEmpty();
      return;
    } catch (e) { /* ลอง endpoint ถัดไป */ }
  }
  showChartEmpty('ไม่มีข้อมูลประวัติ — ต้องมีข้อมูลจาก backend/คลาวด์');
}

function setHistoryRange(hours) {
  HISTORY.hours = hours;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', +b.dataset.hours === hours));
  showChartEmpty('⏳ กำลังโหลดประวัติ...');
  fetchHistory();
}

function drawHistory() {
  const canvas = $('history-chart');
  if (!canvas) return;
  const pts = HISTORY.points;
  const m = METRICS[HISTORY.metric] || METRICS.moisture;
  if (!pts.length) { showChartEmpty('ยังไม่มีข้อมูลในช่วงเวลานี้'); return; }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height || 420;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // ── กราฟค่าที่เลือก (สูงเต็มที่ — สลับจากปุ่มด้านบน) ──
  const pad = { top: 20, right: 66, bottom: 30, left: 54 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const plotBottom = pad.top + plotH;

  const tMin = parseTs(pts[0].timestamp);
  const tMax = parseTs(pts[pts.length - 1].timestamp);
  const span = (tMax - tMin) || 1;
  const x = t => pad.left + ((t - tMin) / span) * plotW;

  // ช่วงสเกลของค่านั้น (ค่าคงที่ หรือคำนวณจากข้อมูล ถ้า auto)
  let rng;
  if (m.min != null && m.max != null) {
    rng = { min: m.min, max: m.max };
  } else {
    const vals = [];
    m.lines.forEach(ln => pts.forEach(pt => {
      const v = (ln.conv || (v => v))(pt[ln.key]);
      if (v != null && !isNaN(v)) vals.push(v);
    }));
    if (vals.length < 2) rng = null;
    else {
      let mn = Math.min(...vals), mx = Math.max(...vals);
      if (m.zero) mn = Math.min(mn, 0);
      const sp = (mx - mn) || 1;
      mn -= sp * 0.08; mx += sp * 0.08;   // เผื่อขอบบน/ล่าง
      rng = { min: mn, max: mx };
    }
  }
  if (!rng) { showChartEmpty('ไม่มีข้อมูลของค่านี้ในช่วงเวลาที่เลือก'); return; }
  const vSpan = (rng.max - rng.min) || 1;
  const y = v => pad.top + plotH - ((v - rng.min) / vSpan) * plotH;

  const fmt = (v, p) => {
    if (p && p.fmt) return p.fmt(v);
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2);
  };

  // เส้นกริดแนวตั้ง 4 เส้น + ป้ายเวลาที่แถวล่าง
  ctx.strokeStyle = 'rgba(34,197,94,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gx = pad.left + (plotW * i) / 4;
    ctx.beginPath();
    ctx.moveTo(gx, pad.top);
    ctx.lineTo(gx, plotBottom);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(148,163,184,0.75)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const gx = pad.left + (plotW * i) / 4;
    const t = new Date(tMin + (span * i) / 4);
    const label = HISTORY.hours > 48
      ? `${t.getDate()}/${t.getMonth() + 1} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    ctx.fillText(label, gx, h - 8);
  }

  // แกน y: 5 ระดับ + เส้นกริดแนวนอน
  ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const v = rng.min + (vSpan * k) / 4;
    const gy = y(v);
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(fmt(v, m), pad.left - 8, gy + 3);
  }

  // ชื่อกราฟ (บนซ้าย)
  ctx.textAlign = 'left';
  ctx.font = '600 11px JetBrains Mono, monospace';
  m.lines.forEach(ln => {
    ctx.fillStyle = ln.color;
    ctx.beginPath();
    ctx.arc(pad.left + 5, pad.top - 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.fillText(m.title, pad.left + 14, pad.top - 5);

  // เส้นข้อมูลของค่านี้
  m.lines.forEach(ln => {
    const conv = ln.conv || (v => v);
    let started = false;
    let lastV = null, lastY = null;
    ctx.strokeStyle = ln.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(pt => {
      const v = conv(pt[ln.key]);
      if (v == null || isNaN(v)) { started = false; return; }
      const px = x(parseTs(pt.timestamp));
      const py = y(v);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
      lastV = v; lastY = py;
    });
    ctx.stroke();

    // ค่าล่าสุดติดขอบขวา
    if (lastV != null) {
      ctx.fillStyle = ln.color;
      ctx.font = '600 11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText((ln.lbl ? ln.lbl + ' ' : '') + fmt(lastV, m), pad.left + plotW + 8, lastY + 4);
    }
  });

  lastDraw = { pts, m, pad, plotW, plotH, tMin, span, rng };
}

// ── Hover/แตะ: ลากเส้นตั้ง + แสดงค่า-เวลา ณ จุดใกล้สุด ──
function fmtTime(s) {
  const t = new Date(parseTs(s));
  if (isNaN(t)) return '';
  return `${t.getDate()}/${t.getMonth() + 1} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

function nearestPoint(ev, canvas) {
  const d = lastDraw;
  const rect = canvas.getBoundingClientRect();
  const mx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
  if (mx < d.pad.left || mx > d.pad.left + d.plotW) return null;
  const frac = (mx - d.pad.left) / d.plotW;
  const i = Math.round(frac * (d.pts.length - 1));
  return Math.max(0, Math.min(d.pts.length - 1, i));
}

function chartHover(ev) {
  const canvas = $('history-chart');
  if (!canvas || !lastDraw || !lastDraw.pts.length) return;
  const idx = nearestPoint(ev, canvas);
  drawHistory();   // วาดใหม่ทั้งกราฟ แล้วค่อยทับตัวอ่านค่า
  if (idx == null) return;
  const d = lastDraw;
  const pt = d.pts[idx];
  const ctx = canvas.getContext('2d');
  const px = d.pad.left + ((parseTs(pt.timestamp) - d.tMin) / d.span) * d.plotW;

  ctx.strokeStyle = 'rgba(148,163,184,0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(px, d.pad.top);
  ctx.lineTo(px, d.pad.top + d.plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  const fmt2 = (v, p) => p && p.fmt ? p.fmt(v) : (Number.isInteger(v) ? String(v) : (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)));
  const parts = [];
  d.m.lines.forEach(ln => {
    const conv = ln.conv || (v => v);
    const v = conv(pt[ln.key]);
    if (v == null || isNaN(v)) return;
    const py = d.pad.top + d.plotH - ((v - d.rng.min) / ((d.rng.max - d.rng.min) || 1)) * d.plotH;
    ctx.fillStyle = ln.color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    parts.push((ln.lbl || d.m.title.split(' (')[0]) + ' ' + fmt2(v, d.m));
  });
  if (!parts.length) return;

  const info = fmtTime(pt.timestamp) + ' · ' + parts.join('  ');
  ctx.font = '600 11px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  const tw = (ctx.measureText ? ctx.measureText(info).width : info.length * 7) + 16;
  const bx = Math.min(d.pad.left + d.plotW - tw, d.pad.left + 8);
  ctx.fillStyle = 'rgba(2,6,23,0.92)';
  ctx.fillRect(bx, d.pad.top - 16, tw, 18);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(info, bx + 8, d.pad.top - 3);
}

window.addEventListener('resize', () => {
  if (HISTORY.points.length) drawHistory();
});

// ─── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  syncCropUI();
  pushCropToCloud(getCropKey());   // แจ้ง backend ตั้งแต่เปิดหน้า — เผื่อเปลี่ยนตอน offline
  startPolling();
  fetchHistory();
  HISTORY.timer = setInterval(fetchHistory, 60000);  // กราฟประวัติรีเฟรชทุก 60 วิ (ไม่ต้องถี่เท่าค่าปัจจุบัน)
  const ch = $('history-chart');
  if (ch) {
    ch.addEventListener('mousemove', chartHover);
    ch.addEventListener('mouseleave', () => { if (HISTORY.points.length) drawHistory(); });
    ch.addEventListener('touchstart', chartHover, { passive: true });
    ch.addEventListener('touchmove', chartHover, { passive: true });
  }
});

// Reconnect when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.online) fetchData();
});
