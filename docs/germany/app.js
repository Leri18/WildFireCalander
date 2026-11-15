/* Feuerkarte Deutschland - Programmlogik. Daten: NASA FIRMS, lokal aufbereitet (siehe build_data.py). */
/* global maplibregl */

const HDR = 16, REC = 28, DAY = 1440;
const EPOCH_MS = Date.UTC(2000, 0, 1);
const DE_BOUNDS = [[5.87, 47.27], [15.04, 55.06]];
const NASA_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const GISCO = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/distribution/';

const SOURCES = {
  VIIRS_NOAA21: { label: 'VIIRS · NOAA-21', res: '375 m' },
  VIIRS_NOAA20: { label: 'VIIRS · NOAA-20', res: '375 m' },
  VIIRS_SNPP: { label: 'VIIRS · Suomi NPP', res: '375 m' },
  MODIS: { label: 'MODIS · Terra und Aqua', res: '1 km' },
  GOES: { label: 'Meteosat, geostationär', res: '2–3 km' },
};
const DRAW_ORDER = ['GOES', 'MODIS', 'VIIRS_SNPP', 'VIIRS_NOAA20', 'VIIRS_NOAA21'];

// Art der Quelle: vier Gruppen fuer Filter und Farbe; CODE_GROUP ordnet die Codes der Binaerdatei zu
const GROUPS = [
  { id: 'veg', label: 'Vegetationsbrand', on: true },
  { id: 'unk', label: 'Nicht eingestuft', on: false },
  { id: 'stat', label: 'Industrie, feste Quelle', on: false },
  { id: 'other', label: 'Offshore', on: false },
];
const CODE_GROUP = [1, 0, 3, 2, 3, 2, 1, 1];
const CODE_TEXT = [
  ['Nicht eingestuft', 'Für echtzeitnahe Daten liegt noch keine Einstufung der NASA vor.'],
  ['Vegetationsbrand', 'Einstufung der NASA: vermuteter Vegetationsbrand.'],
  ['Aktiver Vulkan', 'Einstufung der NASA.'],
  ['Feste Wärmequelle', 'Einstufung der NASA: feste Landquelle, zum Beispiel Industrie.'],
  ['Offshore', 'Einstufung der NASA: Detektion über Wasser.'],
  ['Feste Wärmequelle', 'Abgeleitet: An diesem Ort führt die NASA in älteren Daten eine feste Wärmequelle.'],
  ['Nicht eingestuft', ''], ['Nicht eingestuft', ''],
];
const LEGEND_ORDER = [2, 0, 1, 3];       // feste Quelle, Vegetationsbrand, nicht eingestuft, Offshore

const REGIONS = [
  ['DE1', 'Baden-Württemberg'], ['DE2', 'Bayern'], ['DE3', 'Berlin'], ['DE4', 'Brandenburg'],
  ['DE5', 'Bremen'], ['DE6', 'Hamburg'], ['DE7', 'Hessen'], ['DE8', 'Mecklenburg-Vorpommern'],
  ['DE9', 'Niedersachsen'], ['DEA', 'Nordrhein-Westfalen'], ['DEB', 'Rheinland-Pfalz'], ['DEC', 'Saarland'],
  ['DED', 'Sachsen'], ['DEE', 'Sachsen-Anhalt'], ['DEF', 'Schleswig-Holstein'], ['DEG', 'Thüringen'],
];

// Farben je Kartenstil. Rampe: sechs gleichabstaendige Stufen, auf dunklem Grund wird "mehr" heller,
// auf hellem Grund dunkler. types: Vegetationsbrand, nicht eingestuft, feste Quelle, Offshore.
const RAMP_DARK = ['#d1401f', '#e25a1c', '#f1801e', '#fab02a', '#fddc58', '#fff7c2'];
const RAMP_LIGHT = ['#e06714', '#d4491a', '#c22d24', '#a3182f', '#7d1036', '#3f0a2e'];
const THEMES = {
  dark: {
    ramp: RAMP_DARK, noData: '#9a9891', types: ['#d95926', '#199e70', '#3987e5', '#898781'], additive: true,
    ring: [0.05, 0.05, 0.05, 0.75], mask: 'rgba(0,0,0,0.5)', line: 'rgba(240,239,236,0.26)', outline: 'rgba(240,239,236,0.75)',
    sea: '#0d0d0d', land: '#262624',
  },
  light: {
    ramp: RAMP_LIGHT, noData: '#77756f', types: ['#eb6834', '#199e70', '#2a78d6', '#898781'], additive: false,
    ring: [1, 1, 1, 0.9], mask: 'rgba(252,252,251,0.62)', line: 'rgba(11,11,11,0.22)', outline: 'rgba(11,11,11,0.6)',
    sea: '#dfe3e4', land: '#fcfcfb',
  },
  sat: {
    ramp: RAMP_DARK, noData: '#d0cfc8', types: ['#d95926', '#199e70', '#3987e5', '#898781'], additive: false,
    ring: [0, 0, 0, 0.85], mask: 'rgba(0,0,0,0.42)', line: 'rgba(255,255,255,0.35)', outline: 'rgba(255,255,255,0.85)',
    sea: '#0d0d0d', land: '#262624',
  },
};

// Strassenkarte von OpenStreetMap: helle Karte mit Wegen, Ortsnamen und Flurgrenzen zur genauen Orientierung
THEMES.osm = { ...THEMES.light, mask: 'rgba(252,252,251,0.38)', outline: 'rgba(11,11,11,0.75)' };
const isLight = (b) => b === 'light' || b === 'osm';

/* ------------------------------------------------------------------ Hilfen */
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const msOf = (m) => EPOCH_MS + m * 60000;
const mercY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf5 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
const fmtCount = (n) => (n >= 1e6 ? `${nf2.format(n / 1e6)} Mio.` : nf0.format(n));
const fmtPower = (mw) => (mw >= 1000 ? `${nf1.format(mw / 1000)} GW` : mw >= 100 ? `${nf0.format(mw)} MW` : `${nf1.format(mw)} MW`);
const utc = (o) => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', ...o });
const dfDate = utc({ day: '2-digit', month: '2-digit', year: 'numeric' });
const dfDay = utc({ day: '2-digit', month: '2-digit' });
const dfTime = utc({ hour: '2-digit', minute: '2-digit' });
const dfMonS = utc({ month: 'short' });
const dfMonL = utc({ month: 'long', year: 'numeric' });
const dfLocal = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const fmtDate = (m) => dfDate.format(msOf(m));
const fmtDateTime = (m) => `${dfDate.format(msOf(m))}, ${dfTime.format(msOf(m))}`;
const minOfDate = (y, mo, d = 1) => (Date.UTC(y, mo, d) - EPOCH_MS) / 60000;

/* ------------------------------------------------------------------ Zustand */
const state = {
  t0: 0, t1: 0, v0: 0, v1: 0, full0: 0, full1: 0,
  src: {}, groups: GROUPS.map((g) => g.on), conf: [false, false, true], frpMin: 0, dn: 0,
  region: -2,            // -2 ganzes Rechteck, -1 Deutschland, 0..15 Bundesland
  area: null,            // [West, Sued, Ost, Nord] der selbst gezogenen Flaeche (region -3)
  color: 'frp', basemap: 'sat', preset: '365', playing: false,
};
const data = [];
const ui = {};
let manifest = null, map = null, tl = null, regions = null, stats = null, hist = null, F = null;

try {
  const saved = JSON.parse(localStorage.getItem('feuerkarte2') || '{}');
  if (THEMES[saved.basemap]) state.basemap = saved.basemap;
  if (['frp', 'time', 'type'].includes(saved.color)) state.color = saved.color;
} catch (e) { /* ohne Speicher laeuft es genauso */ }
function savePrefs() {
  try { localStorage.setItem('feuerkarte2', JSON.stringify({ basemap: state.basemap, color: state.color })); } catch (e) { /* egal */ }
}

/* ------------------------------------------------------------------ Daten laden */
async function loadSource(fam, meta, ver) {
  const res = await fetch(`data/${meta.file}?v=${encodeURIComponent(ver)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${meta.file}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  const n = dv.getUint32(8, true);
  if (dv.getUint32(0, true) !== 0x534d5246 || dv.getUint32(12, true) !== REC || buf.byteLength < HDR + n * REC) {
    throw new Error(`${meta.file}: unerwartetes Dateiformat`);
  }
  const f32 = new Float32Array(buf, HDR, n * 7), u16 = new Uint16Array(buf, HDR, n * 14), u8 = new Uint8Array(buf, HDR, n * REC);
  const t = new Uint32Array(n);
  for (let i = 0; i < n; i++) t[i] = u16[i * 14 + 6] * DAY + u16[i * 14 + 7];
  return { fam, meta, n, f32, u16, u8, t, a: 0, b: 0, glBuf: null, dirty: true };
}

/* ------------------------------------------------------------------ Filter und Kennzahlen */
function compileFilter() {
  F = {
    tm: CODE_GROUP.map((g) => state.groups[g]), conf: [state.conf[0], state.conf[1], state.conf[2], true],
    dn: state.dn, frpMin: state.frpMin, region: state.region, area: state.area || [0, 0, 0, 0],
  };
}
function inArea(lon, lat) {
  const a = F.area;
  return lon >= a[0] && lon <= a[2] && lat >= a[1] && lat <= a[3];
}
function passes(src, i) {
  const o = i * REC, flags = src.u8[o + 21];
  if (!F.tm[(flags >> 3) & 7] || !F.conf[(flags >> 1) & 3]) return false;
  if (F.dn && !(flags & 64) && ((flags & 1) === 1) !== (F.dn === 2)) return false;
  if (F.frpMin > 0 && !(src.f32[i * 7 + 2] >= F.frpMin)) return false;
  if (F.region === -3) return inArea(src.f32[i * 7], src.f32[i * 7 + 1]);
  const reg = src.u8[o + 26];
  return F.region === -2 || (F.region === -1 ? reg !== 255 : reg === F.region);
}
function updateRanges() {
  for (const s of data) { s.a = lowerBound(s.t, state.t0); s.b = lowerBound(s.t, state.t1); }
}
// Ein Durchlauf ueber das Zeitfenster. Die Zaehler je Art, Sensor und Land lassen jeweils den
// eigenen Filter aus, damit sie zeigen, was ein Klick bringen wuerde.
function computeStats() {
  const out = { count: 0, frp: 0, max: -1, maxRef: null, byGroup: [0, 0, 0, 0], bySrc: {}, byRegion: new Array(16).fill(0) };
  const { conf, dn, frpMin, region } = F;
  for (const src of data) {
    const on = !!state.src[src.fam], { f32, u8 } = src;
    let nSrc = 0;
    for (let i = src.a; i < src.b; i++) {
      const o = i * REC, flags = u8[o + 21];
      if (!conf[(flags >> 1) & 3]) continue;
      if (dn && !(flags & 64) && ((flags & 1) === 1) !== (dn === 2)) continue;
      const frp = f32[i * 7 + 2];
      if (frpMin > 0 && !(frp >= frpMin)) continue;
      const reg = u8[o + 26];
      const pR = region === -3 ? inArea(f32[i * 7], f32[i * 7 + 1]) : region === -2 || (region === -1 ? reg !== 255 : reg === region);
      const g = CODE_GROUP[(flags >> 3) & 7], pT = state.groups[g];
      if (pT && pR) nSrc++;
      if (!on) continue;
      if (pR) out.byGroup[g]++;
      if (pT && reg < 16) out.byRegion[reg]++;
      if (pT && pR) {
        out.count++;
        if (frp >= 0) { out.frp += frp; if (frp > out.max) { out.max = frp; out.maxRef = { src, i }; } }
      }
    }
    out.bySrc[src.fam] = nSrc;
  }
  return out;
}

function makeBins(v0, v1, pw) {
  const spanDays = (v1 - v0) / DAY;
  const unit = pw / (spanDays * 24) >= 3 ? 'hour' : pw / spanDays >= 3 ? 'day' : pw / (spanDays / 30.44) >= 2.5 ? 'month' : 'year';
  const edges = [];
  if (unit === 'hour' || unit === 'day') {
    const step = unit === 'hour' ? 60 : DAY;
    for (let t = Math.floor(v0 / step) * step; ; t += step) { edges.push(t); if (t >= v1) break; }
  } else {
    const d = new Date(msOf(v0));
    let y = d.getUTCFullYear(), mo = unit === 'month' ? d.getUTCMonth() : 0;
    for (;;) {
      const t = minOfDate(y, mo);
      edges.push(t);
      if (t >= v1) break;
      if (unit === 'month') { mo++; if (mo > 11) { mo = 0; y++; } } else y++;
    }
  }
  return { unit, edges };
}
function computeHistogram() {
  const { unit, edges } = makeBins(state.v0, state.v1, tl.plotWidth());
  const counts = new Float64Array(edges.length - 1);
  const last = edges[edges.length - 1];
  for (const src of data) {
    if (!state.src[src.fam]) continue;
    const t = src.t, end = lowerBound(t, last);
    let b = 0, next = edges[1];
    for (let i = lowerBound(t, edges[0]); i < end; i++) {
      const ti = t[i];
      while (ti >= next) { b++; next = edges[b + 1]; }
      if (passes(src, i)) counts[b]++;
    }
  }
  let max = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
  return { unit, edges, counts, max };
}
function binLabel(unit, t) {
  const ms = msOf(t);
  if (unit === 'hour') return `${dfDate.format(ms)}, ${dfTime.format(ms)}–${dfTime.format(ms + 3600000)} UTC`;
  if (unit === 'day') return dfDate.format(ms);
  if (unit === 'month') return dfMonL.format(ms);
  return String(new Date(ms).getUTCFullYear());
}

/* ------------------------------------------------------------------ Neuzeichnen buendeln */
const RANGES = 1, STATS = 2, HIST = 4, UI = 8;
let pending = 0, raf = 0;
function invalidate(what) {
  pending |= what;
  // In einem verdeckten Tab ruht requestAnimationFrame; dann rechnet ein Timer weiter
  if (!raf) raf = document.hidden ? setTimeout(flush, 60) : requestAnimationFrame(flush);
}
function flush() {
  raf = 0;
  const p = pending;
  pending = 0;
  if (!data.length || !tl) return;
  if (p & RANGES) updateRanges();
  if (p & (RANGES | STATS)) stats = computeStats();
  if (p & HIST) hist = computeHistogram();
  if (p & (RANGES | STATS | UI)) renderUI();
  tl.draw();
  if (map) map.triggerRepaint();
}
function filtersChanged() {
  compileFilter();
  closeDetail();
  invalidate(STATS | HIST | UI);
}

/* ------------------------------------------------------------------ Zeitfenster */
function setWindow(t0, t1, keepPreset) {
  t0 = Math.round(t0);
  t1 = Math.round(t1);
  if (t1 - t0 < 60) t1 = t0 + 60;
  const len = Math.min(t1 - t0, state.full1 - state.full0);
  if (t0 < state.full0) { t0 = state.full0; t1 = t0 + len; }
  if (t1 > state.full1) { t1 = state.full1; t0 = t1 - len; }
  state.t0 = t0;
  state.t1 = t1;
  if (!keepPreset) state.preset = null;
  invalidate(RANGES | UI);
}
function setView(v0, v1) {
  const full = state.full1 - state.full0;
  let span = clamp(v1 - v0, Math.min(2 * DAY, full), full);
  v0 = clamp(v0, state.full0, state.full1 - span);
  state.v0 = v0;
  state.v1 = v0 + span;
  invalidate(HIST);
}
// Zeitleiste so einstellen, dass das Fenster sichtbar und greifbar ist
function revealWindow() {
  const len = state.t1 - state.t0, full = state.full1 - state.full0;
  const px = (tl.plotWidth() * len) / (state.v1 - state.v0);
  if (state.t0 >= state.v0 && state.t1 <= state.v1 && px >= 14) return;
  if (len >= full * 0.4) { setView(state.full0, state.full1); return; }
  const want = Math.min(full, Math.max(len * 8, 30 * DAY));
  setView((state.t0 + state.t1) / 2 - want / 2, (state.t0 + state.t1) / 2 + want / 2);
}
function panViewToWindow() {
  const span = state.v1 - state.v0;
  if (state.t1 - state.t0 > span) { revealWindow(); return; }
  if (state.t1 > state.v1) setView(state.t1 - span, state.t1);
  else if (state.t0 < state.v0) setView(state.t0, state.t0 + span);
}
function applyPreset(p) {
  if (p === 'all') setWindow(state.full0, state.full1, true);
  else setWindow(state.full1 - Number(p) * DAY, state.full1, true);
  state.preset = p;
  revealWindow();
}
function stepWindow(dir) {
  const len = state.t1 - state.t0;
  setWindow(state.t0 + dir * len, state.t1 + dir * len);
  panViewToWindow();
}
let playTimer = 0;
function setPlaying(on) {
  state.playing = on;
  clearInterval(playTimer);
  ui.playBtn.setAttribute('aria-pressed', String(on));
  ui.playBtn.setAttribute('aria-label', on ? 'Anhalten' : 'Abspielen');
  ui.playIcon.setAttribute('d', on ? 'M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z' : 'M6 4.5v11l9-5.5z');
  if (!on) return;
  if (state.t1 >= state.full1) setWindow(state.full0, state.full0 + (state.t1 - state.t0));
  playTimer = setInterval(() => {
    const len = state.t1 - state.t0;
    const step = len <= 2 * DAY ? 180 : Math.max(DAY, Math.round(len / 24 / DAY) * DAY);
    if (state.t1 >= state.full1) { setPlaying(false); return; }
    setWindow(state.t0 + step, state.t1 + step);
    panViewToWindow();
  }, 160);
}

/* ------------------------------------------------------------------ Zeitleiste (Canvas) */
function createTimeline(canvas) {
  const ctx = canvas.getContext('2d');
  const M = { l: 46, r: 10, t: 8, b: 18 };
  let W = 0, H = 0, dpr = 1, hover = -1, drag = null;
  const pw = () => Math.max(50, W - M.l - M.r);
  const ph = () => Math.max(20, H - M.t - M.b);
  const xOf = (t) => M.l + ((t - state.v0) / (state.v1 - state.v0)) * pw();
  const tOf = (x) => state.v0 + ((x - M.l) / pw()) * (state.v1 - state.v0);
  const snapStep = () => (hist && hist.unit === 'hour' ? 60 : DAY);
  const snap = (t) => Math.round(t / snapStep()) * snapStep();

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
  }
  function niceTop(max) {
    if (max <= 0) return { max: 1, ticks: [0] };
    const raw = max / 2, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
    const top = Math.ceil(max / step) * step, ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { max: top, ticks };
  }
  function xTicks() {
    const pxDay = pw() / ((state.v1 - state.v0) / DAY), out = [];
    const d0 = new Date(msOf(state.v0));
    if (pxDay >= 180) {
      const step = pxDay >= 700 ? 180 : 360;
      for (let t = Math.ceil(state.v0 / step) * step; t <= state.v1; t += step) {
        out.push({ t, label: t % DAY === 0 ? dfDay.format(msOf(t)) : dfTime.format(msOf(t)) });
      }
    } else if (pxDay >= 5) {
      const step = (pxDay >= 34 ? 1 : pxDay >= 12 ? 3 : 7) * DAY;
      for (let t = Math.ceil(state.v0 / step) * step; t <= state.v1; t += step) out.push({ t, label: dfDay.format(msOf(t)) });
    } else if (pxDay >= 0.33) {
      const every = pxDay >= 1.2 ? 1 : 3;
      let y = d0.getUTCFullYear(), mo = d0.getUTCMonth();
      for (;;) {
        const t = minOfDate(y, mo);
        if (t > state.v1) break;
        if (t >= state.v0 && mo % every === 0) out.push({ t, label: mo === 0 ? String(y) : dfMonS.format(msOf(t)) });
        mo++;
        if (mo > 11) { mo = 0; y++; }
      }
    } else {
      const pxYear = pxDay * 365.25, stepY = pxYear >= 40 ? 1 : pxYear >= 20 ? 2 : pxYear >= 8 ? 5 : 10;
      for (let y = d0.getUTCFullYear(); ; y++) {
        const t = minOfDate(y, 0);
        if (t > state.v1) break;
        if (t >= state.v0 && y % stepY === 0) out.push({ t, label: String(y) });
      }
    }
    return out;
  }
  function draw() {
    if (!W || !H) return;
    const cs = getComputedStyle(document.documentElement);
    const C = (n) => cs.getPropertyValue(n).trim();
    const accent = C('--accent'), off = C('--bar-off'), muted = C('--muted');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const x0 = M.l, width = pw(), height = ph(), yb = M.t + height;
    const top = niceTop(hist ? hist.max : 0);

    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of top.ticks) {
      const y = Math.round(yb - (v / top.max) * height) + 0.5;
      if (v > 0) { ctx.strokeStyle = C('--grid'); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + width, y); ctx.stroke(); }
      ctx.fillStyle = muted;
      ctx.fillText(nf0.format(v), x0 - 7, y);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, width, H);
    ctx.clip();
    const sa = xOf(state.t0), sb = xOf(state.t1);
    ctx.fillStyle = C('--accent-wash');
    ctx.fillRect(sa, M.t - 4, Math.max(1, sb - sa), height + 4);
    if (hist) {
      const { edges, counts } = hist;
      for (let i = 0; i < counts.length; i++) {
        const c = counts[i];
        if (!c) continue;
        const a = xOf(edges[i]), b = xOf(edges[i + 1]), bw = b - a;
        const gap = bw >= 6 ? 2 : bw >= 3 ? 1 : 0;
        const w = Math.min(24, Math.max(1, bw - gap)), x = a + (bw - w) / 2;
        const h = Math.max(1, (c / top.max) * height);
        const mid = (edges[i] + edges[i + 1]) / 2;
        ctx.fillStyle = mid >= state.t0 && mid < state.t1 ? accent : off;
        if (i === hover) ctx.globalAlpha = 0.72;
        const r = Math.min(4, w / 2, h);
        if (w >= 5 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, yb - h, w, h, [r, r, 0, 0]); ctx.fill(); } else ctx.fillRect(x, yb - h, w, h);
        ctx.globalAlpha = 1;
      }
    }
    // Rand und Griffe des gewaehlten Zeitraums
    ctx.fillStyle = accent;
    for (const x of [sa, sb]) {
      ctx.fillRect(Math.round(x) - 1, M.t - 4, 2, height + 4);
      const gy = M.t + height / 2 - 11;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(Math.round(x) - 3, gy, 6, 22, 3); ctx.fill(); } else ctx.fillRect(Math.round(x) - 3, gy, 6, 22);
    }
    ctx.restore();

    ctx.strokeStyle = C('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, yb + 0.5);
    ctx.lineTo(x0 + width, yb + 0.5);
    ctx.stroke();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    let lastRight = -1e9;
    for (const tk of xTicks()) {
      const x = xOf(tk.t), tw = ctx.measureText(tk.label).width;
      const lx = clamp(x, x0 + tw / 2, x0 + width - tw / 2);
      if (lx - tw / 2 < lastRight + 8) continue;
      ctx.fillRect(Math.round(x), yb + 1, 1, 3);
      ctx.fillText(tk.label, lx, yb + 5);
      lastRight = lx + tw / 2;
    }
  }

  function binAt(x) {
    if (!hist || x < M.l || x > M.l + pw()) return -1;
    const t = tOf(x), e = hist.edges;
    let lo = 0, hi = e.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (e[m] <= t) lo = m; else hi = m; }
    return lo;
  }
  function modeAt(x) {
    const a = xOf(state.t0), b = xOf(state.t1), near = 7;
    if (b - a < 16) {
      if (x >= a && x <= b) return 'move';
      if (x < a && a - x <= near) return 'l';
      if (x > b && x - b <= near) return 'r';
      return 'new';
    }
    if (Math.abs(x - a) <= near) return 'l';
    if (Math.abs(x - b) <= near) return 'r';
    return x > a && x < b ? 'move' : 'new';
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x = e.offsetX;
    drag = { mode: modeAt(x), x, t0: state.t0, t1: state.t1, anchor: snap(tOf(x)), moved: false };
    canvas.setPointerCapture(e.pointerId);
    setPlaying(false);
    hideTip();
  });
  canvas.addEventListener('pointermove', (e) => {
    const x = e.offsetX;
    if (drag) {
      if (Math.abs(x - drag.x) > 2) drag.moved = true;
      if (!drag.moved) return;
      const step = snapStep(), t = snap(tOf(x));
      if (drag.mode === 'l') setWindow(Math.min(t, state.t1 - step), state.t1);
      else if (drag.mode === 'r') setWindow(state.t0, Math.max(t, state.t0 + step));
      else if (drag.mode === 'move') { const d = snap(tOf(x) - tOf(drag.x)); setWindow(drag.t0 + d, drag.t1 + d); } else {
        setWindow(Math.min(drag.anchor, t), Math.max(drag.anchor, t, Math.min(drag.anchor, t) + step));
      }
      return;
    }
    const m = modeAt(x);
    canvas.style.cursor = m === 'l' || m === 'r' ? 'ew-resize' : m === 'move' ? 'grab' : 'crosshair';
    const b = binAt(x);
    if (b !== hover) { hover = b; draw(); }
    if (b >= 0) {
      showTip(e.clientX, e.clientY, [
        ['v', `${nf0.format(hist.counts[b])} ${hist.counts[b] === 1 ? 'Detektion' : 'Detektionen'}`],
        ['l', binLabel(hist.unit, hist.edges[b])],
      ]);
    } else hideTip();
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (!drag.moved && drag.mode === 'new') {
      const len = state.t1 - state.t0, c = snap(tOf(e.offsetX) - len / 2);
      setWindow(c, c + len);
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (hover !== -1) { hover = -1; draw(); } hideTip(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    hover = -1;
    hideTip();
    const span = state.v1 - state.v0;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.deltaX || e.deltaY) / pw()) * span;
      setView(state.v0 + d, state.v1 + d);
    } else {
      const k = Math.exp(clamp(e.deltaY, -300, 300) * 0.0016), tc = tOf(clamp(e.offsetX, M.l, M.l + pw()));
      setView(tc - (tc - state.v0) * k, tc + (state.v1 - tc) * k);
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', () => setView(state.full0, state.full1));
  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1, d = e.shiftKey ? state.t1 - state.t0 : snapStep();
    setWindow(state.t0 + dir * d, state.t1 + dir * d);
    panViewToWindow();
  });
  return { resize, draw, plotWidth: pw };
}

/* ------------------------------------------------------------------ Tooltip */
function showTip(cx, cy, rows) {
  const tip = ui.tip;
  tip.textContent = '';
  for (const [cls, text] of rows) tip.append(el('div', cls, text));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > window.innerWidth - 8) x = cx - r.width - 14;
  if (y < 8) y = cy + 16;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { ui.tip.hidden = true; }

/* ------------------------------------------------------------------ Punkt-Ebene (WebGL) */
const VS = `
precision highp float;
attribute vec2 a_pos;
attribute float a_frp;
attribute vec2 a_time;
attribute vec4 a_meta;
attribute vec4 a_meta2;
uniform mat4 u_matrix;
uniform float u_world, u_dpr, u_day0, u_dn, u_region, u_frpMin, u_mode, u_minSize, u_alpha;
uniform vec2 u_win;
uniform vec4 u_area;
uniform float u_types[8];
uniform float u_conf[4];
uniform vec3 u_ramp[6];
uniform vec3 u_typeColor[8];
uniform vec3 u_noData;
varying vec4 v_color;
varying float v_size;
const float PI = 3.141592653589793;
void main() {
  float flags = a_meta.y;
  float night = mod(flags, 2.0);
  float cls = mod(floor(flags / 2.0), 4.0);
  float typ = mod(floor(flags / 8.0), 8.0);
  float dnUnknown = mod(floor(flags / 64.0), 2.0);
  float t = (a_time.x - u_day0) * 1440.0 + a_time.y;
  bool ok = t >= u_win.x && t < u_win.y;
  if (u_types[int(typ + 0.5)] < 0.5 || u_conf[int(cls + 0.5)] < 0.5) ok = false;
  if (u_dn > 0.5 && dnUnknown < 0.5 && ((night > 0.5) != (u_dn > 1.5))) ok = false;
  float reg = a_meta2.z;
  if (u_region < -2.5) {
    if (a_pos.x < u_area.x || a_pos.x > u_area.z || a_pos.y < u_area.y || a_pos.y > u_area.w) ok = false;
  } else if (u_region > -1.5) {
    if (u_region < -0.5) { if (reg > 254.5) ok = false; }
    else if (abs(reg - u_region) > 0.5) ok = false;
  }
  if (u_frpMin > 0.0 && a_frp < u_frpMin) ok = false;
  if (!ok) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_color = vec4(0.0);
    v_size = 0.0;
    return;
  }
  float lat = radians(a_pos.y);
  float x = (a_pos.x + 180.0) / 360.0;
  float y = 0.5 - log(tan(PI * 0.25 + lat * 0.5)) / (2.0 * PI);
  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  float foot = max(a_meta.z, a_meta.w) * 20.0;
  float px = foot * u_world / (40075016.686 * cos(lat));
  // Groessere Strahlungsleistung -> groesserer Punkt, damit sich starke Feuer auf einen Blick abheben
  float frpS = a_frp > 0.0 ? clamp(0.8 + 0.4 * log(1.0 + a_frp), 1.0, 2.4) : 1.0;
  v_size = max(u_minSize * frpS, px) * u_dpr;
  gl_PointSize = v_size + 2.0;
  vec3 c;
  if (u_mode > 1.5) {
    c = u_typeColor[int(typ + 0.5)];
  } else if (u_mode < 0.5 && a_frp < 0.0) {
    c = u_noData;
  } else {
    float s = u_mode < 0.5 ? log(max(a_frp, 1.0)) / 6.907755 : (t - u_win.x) / max(u_win.y - u_win.x, 1.0);
    s = clamp(s, 0.0, 1.0) * 5.0;
    int i = int(floor(s));
    if (i > 4) i = 4;
    c = mix(u_ramp[i], u_ramp[i + 1], s - float(i));
  }
  float a = u_alpha;
  if (px > u_minSize) a *= clamp(u_minSize * 2.6 / px, 0.62, 1.0);
  v_color = vec4(c, a);
}`;
const FS = `
precision mediump float;
varying vec4 v_color;
varying float v_size;
uniform vec4 u_ring;
void main() {
  float d = length(gl_PointCoord - 0.5) * (v_size + 2.0);
  float r = v_size * 0.5;
  float a = 1.0 - smoothstep(r - 0.75, r + 0.75, d);
  if (a < 0.004) discard;
  float rw = clamp(v_size * 0.16, 1.0, 2.4);
  float ring = u_ring.a * smoothstep(r - rw - 0.7, r - rw + 0.3, d) * step(5.0, v_size);
  vec3 c = mix(v_color.rgb, u_ring.rgb, ring);
  float alpha = v_color.a * a;
  gl_FragColor = vec4(c * alpha, alpha);
}`;

function pointStyle() {
  const zoom = map.getZoom();
  let n = 0;
  for (const s of data) if (state.src[s.fam]) n += s.b - s.a;
  const zf = clamp((zoom - 5) / 4, 0, 1);
  const dens = clamp((Math.log10(Math.max(n, 1)) - 2.7) / 2.8, 0, 1);
  // Auf dem Satellitenbild brauchen die Punkte mehr Flaeche, um sich vom unruhigen Grund abzuheben
  const boost = state.basemap === 'sat' ? 1.45 : 1;
  return { minSize: boost * lerp(lerp(6.2, 2.9, dens), lerp(10, 6.5, dens), zf), alpha: lerp(lerp(1, 0.72, dens), 1, zf) };
}

const fireLayer = {
  id: 'fires', type: 'custom', renderingMode: '2d',
  onAdd(m, gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Programm: ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.at = {};
    for (const a of ['a_pos', 'a_frp', 'a_time', 'a_meta', 'a_meta2']) this.at[a] = gl.getAttribLocation(p, a);
    this.un = {};
    for (const u of ['u_matrix', 'u_world', 'u_dpr', 'u_day0', 'u_dn', 'u_region', 'u_frpMin', 'u_mode', 'u_minSize', 'u_alpha',
      'u_win', 'u_area', 'u_types', 'u_conf', 'u_ramp', 'u_typeColor', 'u_noData', 'u_ring']) this.un[u] = gl.getUniformLocation(p, u);
    for (const s of data) { s.glBuf = null; s.dirty = true; }
  },
  render(gl, arg) {
    if (!data.length || !F) return;
    const matrix = arg && arg.length ? arg : (arg.defaultProjectionData && arg.defaultProjectionData.mainMatrix) || arg.modelViewProjectionMatrix;
    const th = THEMES[state.basemap], un = this.un, at = this.at;
    const mode = state.color === 'frp' ? 0 : state.color === 'time' ? 1 : 2;
    const additive = th.additive && mode !== 2;
    const st = pointStyle();
    gl.useProgram(this.p);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    const day0 = Math.floor(state.t0 / DAY);
    gl.uniformMatrix4fv(un.u_matrix, false, matrix);
    gl.uniform1f(un.u_world, 512 * Math.pow(2, map.getZoom()));
    gl.uniform1f(un.u_dpr, gl.canvas.width / Math.max(1, gl.canvas.clientWidth));
    gl.uniform1f(un.u_day0, day0);
    gl.uniform2f(un.u_win, state.t0 - day0 * DAY, state.t1 - day0 * DAY);
    gl.uniform1f(un.u_dn, F.dn);
    gl.uniform1f(un.u_region, F.region);
    gl.uniform4f(un.u_area, F.area[0], F.area[1], F.area[2], F.area[3]);
    gl.uniform1f(un.u_frpMin, F.frpMin);
    gl.uniform1f(un.u_mode, mode);
    gl.uniform1f(un.u_minSize, st.minSize);
    gl.uniform1f(un.u_alpha, additive ? st.alpha : Math.max(0.8, st.alpha));
    gl.uniform1fv(un.u_types, F.tm.map((v) => (v ? 1 : 0)));
    gl.uniform1fv(un.u_conf, F.conf.map((v) => (v ? 1 : 0)));
    gl.uniform3fv(un.u_ramp, th.ramp.flatMap(hex));
    gl.uniform3fv(un.u_typeColor, CODE_GROUP.flatMap((g) => hex(th.types[g])));
    gl.uniform3fv(un.u_noData, hex(th.noData));
    gl.uniform4f(un.u_ring, th.ring[0], th.ring[1], th.ring[2], additive ? 0 : th.ring[3]);
    const ptr = (loc, size, type, off) => {
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, false, REC, off);
    };
    for (const fam of DRAW_ORDER) {
      const s = data.find((d) => d.fam === fam);
      if (!s || !state.src[fam] || s.b <= s.a) continue;
      if (!s.glBuf) { s.glBuf = gl.createBuffer(); s.dirty = true; }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.glBuf);
      if (s.dirty) { gl.bufferData(gl.ARRAY_BUFFER, s.u8, gl.STATIC_DRAW); s.dirty = false; }
      ptr(at.a_pos, 2, gl.FLOAT, 0);
      ptr(at.a_frp, 1, gl.FLOAT, 8);
      ptr(at.a_time, 2, gl.UNSIGNED_SHORT, 12);
      ptr(at.a_meta, 4, gl.UNSIGNED_BYTE, 20);
      ptr(at.a_meta2, 4, gl.UNSIGNED_BYTE, 24);
      gl.drawArrays(gl.POINTS, s.a, s.b - s.a);
    }
    for (const k of Object.keys(at)) if (at[k] >= 0) gl.disableVertexAttribArray(at[k]);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },
};

/* ------------------------------------------------------------------ Punkt unter dem Mauszeiger */
function pick(point) {
  const world = 512 * Math.pow(2, map.getZoom());
  const ll = map.unproject(point);
  const mx = (ll.lng + 180) / 360, my = mercY(ll.lat);
  const cosLat = Math.cos((ll.lat * Math.PI) / 180);
  const pxPerM = world / (40075016.686 * cosLat);
  const { minSize } = pointStyle();
  const maxR = Math.max(9, (255 * 20 * pxPerM) / 2);
  const dLon = (maxR / world) * 360, dLat = dLon * cosLat;
  let best = null, bestD = Infinity;
  for (const src of data) {
    if (!state.src[src.fam]) continue;
    const { f32, u8 } = src;
    for (let i = src.a; i < src.b; i++) {
      const lon = f32[i * 7];
      if (lon < ll.lng - dLon || lon > ll.lng + dLon) continue;
      const lat = f32[i * 7 + 1];
      if (lat < ll.lat - dLat || lat > ll.lat + dLat) continue;
      if (!passes(src, i)) continue;
      const dx = ((lon + 180) / 360 - mx) * world, dy = (mercY(lat) - my) * world;
      const d = Math.sqrt(dx * dx + dy * dy);
      const size = Math.max(minSize, Math.max(u8[i * REC + 22], u8[i * REC + 23]) * 20 * pxPerM);
      if (d <= Math.max(size / 2, 9) && d <= bestD) { bestD = d; best = { src, i }; }
    }
  }
  return best;
}

function satName(s) {
  const known = { N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', T: 'Terra', A: 'Aqua', Terra: 'Terra', Aqua: 'Aqua' };
  if (known[s]) return known[s];
  let m = /^Met(\d+)$/.exec(s);
  if (m) return `Meteosat-${m[1]}`;
  m = /^G(\d+)/.exec(s);
  if (m) return `GOES-${m[1]}`;
  m = /^Him(\d+)$/.exec(s);
  if (m) return `Himawari-${m[1]}`;
  return s || 'unbekannt';
}
function describe(ref) {
  const { src, i } = ref, o = i * REC, { f32, u16, u8 } = src;
  const flags = u8[o + 21], code = (flags >> 3) & 7;
  return {
    src, i, lon: f32[i * 7], lat: f32[i * 7 + 1], frp: f32[i * 7 + 2], t: src.t[i],
    b1: u16[i * 14 + 8] / 10, b2: u16[i * 14 + 9] / 10, conf: u8[o + 20], cls: (flags >> 1) & 3, code,
    group: CODE_GROUP[code], night: flags & 1, dnUnknown: flags & 64, nrt: flags & 128,
    scan: u8[o + 22] * 0.02, track: u8[o + 23] * 0.02,
    sat: src.meta.sat[u8[o + 24]] || '', ver: src.meta.ver[u8[o + 25]] || '', region: u8[o + 26],
  };
}
function showDetail(ref) {
  const d = describe(ref), th = THEMES[state.basemap];
  const root = el('div');
  const kind = el('div', 'pop-kind');
  const sw = el('span', 'swatch');
  sw.style.background = th.types[d.group];
  kind.append(sw, el('span', null, CODE_TEXT[d.code][0]));
  root.append(kind, el('div', 'pop-when', `${fmtDateTime(d.t)} UTC · ${dfLocal.format(msOf(d.t))}`));
  const dl = el('dl', 'pop-grid');
  const row = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
  row('Strahlungsleistung', d.frp >= 0 ? `${nf1.format(d.frp)} MW` : 'keine Angabe');
  if (d.b1 > 0) row('Helligkeit bei 4 µm', `${nf1.format(d.b1)} K`);
  if (d.b2 > 0) row('Helligkeit bei 11 µm', `${nf1.format(d.b2)} K`);
  const cls = ['niedrig', 'nominal', 'hoch', 'keine Angabe'][d.cls];
  row('Konfidenz', d.conf <= 100 ? `${d.conf} % (${cls})` : cls);
  if (!d.dnUnknown) row('Aufnahme', d.night ? 'bei Nacht' : 'bei Tag');
  if (d.scan > 0) row('Pixelgröße', src_geo(d.src) ? `etwa ${nf0.format(d.scan)} km` : `etwa ${nf2.format(d.scan)} × ${nf2.format(d.track)} km`);
  const inst = instrumentOf(d.src.fam, d.sat);
  row('Satellit', `${satName(d.sat)}${inst ? ` · ${inst}` : ''}`);
  row('Datenstand', `${d.nrt ? 'echtzeitnah (NRT)' : 'geprüft (SP)'}${d.ver ? `, Version ${d.ver}` : ''}`);
  if (d.region < 16) row('Bundesland', REGIONS[d.region][1]);
  else if (regions) row('Lage', 'außerhalb Deutschlands');
  row('Koordinaten', `${nf5.format(d.lat)}° N, ${nf5.format(d.lon)}° O`);
  root.append(dl);
  if (CODE_TEXT[d.code][1]) root.append(el('div', 'pop-note', CODE_TEXT[d.code][1]));
  const links = el('div', 'pop-links');
  const copy = el('button', null, 'Koordinaten kopieren');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}`); copy.textContent = 'Kopiert'; } catch (e) { copy.textContent = 'Kopieren nicht möglich'; }
  });
  const wv = el('a', null, 'Satellitenbild bei NASA Worldview');
  const iso = new Date(msOf(d.t)).toISOString().slice(0, 10);
  wv.href = `https://worldview.earthdata.nasa.gov/?v=${(d.lon - 0.9).toFixed(3)},${(d.lat - 0.45).toFixed(3)},${(d.lon + 0.9).toFixed(3)},${(d.lat + 0.45).toFixed(3)}&t=${iso}`;
  wv.target = '_blank';
  wv.rel = 'noopener';
  links.append(copy, wv);
  root.append(links);
  const close = el('button', 'icon-btn detail-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Einzelheiten schließen');
  close.textContent = '×';
  close.addEventListener('click', closeDetail);
  ui.detail.textContent = '';
  ui.detail.append(close, root);
  ui.detail.hidden = false;
  // Ring auf der Karte zeigt, welche Detektion gemeint ist
  if (selMarker) selMarker.remove();
  selMarker = new maplibregl.Marker({ element: el('div', 'sel-ring') }).setLngLat([d.lon, d.lat]).addTo(map);
}
let selMarker = null;
function closeDetail() {
  ui.detail.hidden = true;
  ui.detail.textContent = '';
  if (selMarker) { selMarker.remove(); selMarker = null; }
}
function src_geo(src) { return src.fam === 'GOES'; }
function instrumentOf(fam, sat) {
  if (fam.startsWith('VIIRS')) return 'VIIRS';
  if (fam === 'MODIS') return 'MODIS';
  const m = /^Met(\d+)$/.exec(sat);
  if (m) return Number(m[1]) >= 12 ? 'FCI' : 'SEVIRI';
  if (/^G\d+/.test(sat)) return 'ABI';
  if (/^Him/.test(sat)) return 'AHI';
  return '';
}

/* ------------------------------------------------------------------ Grenzen: Bundeslaender (Eurostat GISCO) */
async function fetchGeo(id) {
  const url = `${GISCO}${id}-region-01m-4326-2021.geojson`;
  let cache = null;
  try {
    cache = await caches.open('feuerkarte-grenzen-v1');
    const hit = await cache.match(url);
    if (hit) return await hit.json();
  } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Grenzdaten ${id}: HTTP ${res.status}`);
  if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* Cache voll oder gesperrt */ } }
  return res.json();
}
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
// Flaeche zeilenweise fuellen (Gerade-Ungerade-Regel, Abtastung in der Pixelmitte)
function rasterize(mask, W, H, lon0, lat1, res, polys, value) {
  const rows = new Array(H);
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0, n = ring.length - 1; i < n; i++) {
        let x1 = (ring[i][0] - lon0) / res, y1 = (lat1 - ring[i][1]) / res;
        let x2 = (ring[i + 1][0] - lon0) / res, y2 = (lat1 - ring[i + 1][1]) / res;
        if (y1 === y2) continue;
        if (y1 > y2) { let s = x1; x1 = x2; x2 = s; s = y1; y1 = y2; y2 = s; }
        const r0 = Math.max(0, Math.ceil(y1 - 0.5)), r1 = Math.min(H - 1, Math.ceil(y2 - 0.5) - 1);
        const k = (x2 - x1) / (y2 - y1);
        for (let r = r0; r <= r1; r++) (rows[r] || (rows[r] = [])).push(x1 + (r + 0.5 - y1) * k);
      }
    }
  }
  for (let r = 0; r < H; r++) {
    const xs = rows[r];
    if (!xs) continue;
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      const c0 = Math.max(0, Math.ceil(xs[j] - 0.5)), c1 = Math.min(W - 1, Math.ceil(xs[j + 1] - 0.5) - 1);
      if (c1 >= c0) mask.fill(value, r * W + c0, r * W + c1 + 1);
    }
  }
}
async function loadRegions() {
  const [w, s, e, n] = (manifest.area || '5.5,47,15.5,55.5').split(',').map(Number);
  const files = await Promise.all([...REGIONS.map((r) => fetchGeo(r[0])), fetchGeo('DE')]);
  const feats = files.map((fc) => (fc.features ? fc.features[0] : fc));
  const res = 0.0025, W = Math.ceil((e - w) / res), H = Math.ceil((n - s) / res);
  const mask = new Uint8Array(W * H).fill(255);
  const bounds = [];
  REGIONS.forEach((r, k) => {
    const polys = polysOf(feats[k].geometry);
    rasterize(mask, W, H, w, n, res, polys, k);
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const poly of polys) for (const p of poly[0]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    bounds.push([[x0, y0], [x1, y1]]);
  });
  for (const src of data) {
    const { f32, u8 } = src;
    for (let i = 0; i < src.n; i++) {
      const cx = Math.floor((f32[i * 7] - w) / res), cy = Math.floor((n - f32[i * 7 + 1]) / res);
      u8[i * REC + 26] = cx >= 0 && cx < W && cy >= 0 && cy < H ? mask[cy * W + cx] : 255;
    }
    src.dirty = true;
  }
  const regionAt = (lon, lat) => {
    const cx = Math.floor((lon - w) / res), cy = Math.floor((n - lat) / res);
    return cx >= 0 && cx < W && cy >= 0 && cy < H ? mask[cy * W + cx] : 255;
  };
  return { feats, bounds, regionAt };
}
function addRegionLayers() {
  if (!regions || !map || !map.getLayer('fires') || map.getSource('de-states')) return;
  const th = THEMES[state.basemap];
  const de = regions.feats[16];
  const holes = polysOf(de.geometry).map((p) => p[0]);
  map.addSource('de-mask', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-40, 20], [70, 20], [70, 78], [-40, 78], [-40, 20]], ...holes] } } });
  map.addSource('de-states', { type: 'geojson', data: { type: 'FeatureCollection', features: regions.feats.slice(0, 16) } });
  map.addSource('de-outline', { type: 'geojson', data: de });
  map.addLayer({ id: 'de-land', type: 'fill', source: 'de-outline', paint: { 'fill-color': th.land } }, 'base-dark');
  map.addLayer({ id: 'de-mask', type: 'fill', source: 'de-mask', paint: { 'fill-color': th.mask, 'fill-antialias': false } }, 'fires');
  map.addLayer({ id: 'de-states', type: 'line', source: 'de-states', paint: { 'line-color': th.line, 'line-width': 0.8 } }, 'fires');
  map.addLayer({ id: 'de-outline', type: 'line', source: 'de-outline', paint: { 'line-color': th.outline, 'line-width': 1.4 } }, 'fires');
  // Umriss des gewaehlten Bundeslands (Filter setzt selectRegion)
  map.addLayer({
    id: 'de-sel', type: 'line', source: 'de-states', filter: ['==', ['get', 'NUTS_ID'], ''],
    paint: { 'line-color': isLight(state.basemap) ? '#2a78d6' : '#3987e5', 'line-width': 2.4 },
  }, 'fires');
}

/* ------------------------------------------------------------------ Karte */
function mapPadding() {
  const wide = window.innerWidth > 860, open = !document.body.classList.contains('panel-closed');
  const tlH = ui.timeline ? ui.timeline.getBoundingClientRect().height : 164;
  const card = wide && ui.detail && !ui.detail.hidden && window.innerWidth > 1100;
  return { top: 24, right: card ? 300 + 76 : 24, bottom: tlH + 36, left: wide && open ? 316 + 36 : 24 };
}
function initMap() {
  const esri = (path) => [`https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`];
  const esriAttr = '© <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';
  const satAttr = 'Satellitenbild: © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics';
  // Weltweites Satellitenbild der NASA (Blue Marble, 500 m), liegt unter dem hochaufgeloesten Bild
  const nasaAttr = 'Satellitenbild: NASA Blue Marble (GIBS)';
  const rs = (tiles, attribution, maxzoom) => ({ type: 'raster', tiles, tileSize: 256, attribution, maxzoom });
  const hid = { visibility: 'none' };
  const style = {
    version: 8,
    sources: {
      'base-dark': rs(esri('Canvas/World_Dark_Gray_Base'), esriAttr, 16),
      'labels-dark': rs(esri('Canvas/World_Dark_Gray_Reference'), '', 16),
      'base-light': rs(esri('Canvas/World_Light_Gray_Base'), esriAttr, 16),
      'labels-light': rs(esri('Canvas/World_Light_Gray_Reference'), '', 16),
      'sat-nasa': rs([NASA_TILES], nasaAttr, 8),
      osm: rs(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende', 19),
      'sat-blue': rs(esri('World_Imagery'), satAttr, 19),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0d0d0d' } },
      { id: 'base-dark', type: 'raster', source: 'base-dark' },
      { id: 'base-light', type: 'raster', source: 'base-light', layout: hid },
      { id: 'osm', type: 'raster', source: 'osm', layout: hid },
      { id: 'sat-nasa', type: 'raster', source: 'sat-nasa', layout: hid },
      { id: 'sat-blue', type: 'raster', source: 'sat-blue', layout: hid },
      { id: 'labels-dark', type: 'raster', source: 'labels-dark' },
      { id: 'labels-light', type: 'raster', source: 'labels-light', layout: hid },
    ],
  };
  map = new maplibregl.Map({
    container: 'map', style, bounds: DE_BOUNDS, fitBoundsOptions: { padding: mapPadding() },
    minZoom: 1, maxZoom: 18, attributionControl: false,
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // Eigener Standort: springt zur Position des Geraets (der Browser fragt vorher um Erlaubnis)
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, fitBoundsOptions: { maxZoom: 14 } }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Feuerdaten: <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> · Grenzen: © EuroGeographics',
  }), 'bottom-right');

  let hoverEvt = null, hoverRaf = 0;
  map.on('mousemove', (e) => {
    hoverEvt = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (!hoverEvt || map.isMoving()) { hideTip(); return; }
      const hit = pick(hoverEvt.point);
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
      if (!hit) { hideTip(); return; }
      const d = describe(hit);
      showTip(hoverEvt.originalEvent.clientX, hoverEvt.originalEvent.clientY, [
        ['v', d.frp >= 0 ? fmtPower(d.frp) : CODE_TEXT[d.code][0]],
        ['l', `${CODE_TEXT[d.code][0]} · ${fmtDateTime(d.t)} UTC`],
        ['l', SOURCES[d.src.fam] ? SOURCES[d.src.fam].label : d.src.fam],
      ]);
    });
  });
  map.on('mouseout', () => { hoverEvt = null; hideTip(); });
  map.on('movestart', hideTip);
  map.on('click', (e) => {
    const hit = pick(e.point);
    if (hit) showDetail(hit);
    else closeDetail();
  });
  // Erreichbarkeit der Hintergrundkacheln mitzaehlen (siehe checkTiles)
  map.on('error', (e) => {
    if (!e || !e.sourceId || !e.tile) return;
    (tileStat[e.sourceId] || (tileStat[e.sourceId] = { ok: 0, err: 0 })).err++;
    checkTiles();
  });
  map.on('data', (e) => {
    if (e.dataType !== 'source' || !e.tile || !e.sourceId || e.tile.state !== 'loaded') return;
    (tileStat[e.sourceId] || (tileStat[e.sourceId] = { ok: 0, err: 0 })).ok++;
    checkTiles();
  });
  // Nicht auf alle Kacheln warten: die Punkte sollen auch ohne Hintergrundkarte erscheinen.
  // (In einem verdeckten Browser-Tab meldet sich die Karte erst, wenn der Tab sichtbar wird.)
  return new Promise((resolve) => {
    map.once('style.load', resolve);
    map.once('load', resolve);
  });
}

// Faellt die Hintergrundkarte aus (kein Netz, Anbieter gestoert), bleibt eine vereinfachte Karte aus
// den Laendergrenzen; dann helfen Staedtenamen bei der Orientierung.
const CITIES = [
  ['Berlin', 13.405, 52.52], ['Hamburg', 9.993, 53.551], ['München', 11.576, 48.137], ['Köln', 6.953, 50.938],
  ['Frankfurt', 8.682, 50.111], ['Stuttgart', 9.183, 48.776], ['Leipzig', 12.373, 51.34], ['Dortmund', 7.466, 51.514],
  ['Bremen', 8.807, 53.079], ['Dresden', 13.738, 51.05], ['Hannover', 9.732, 52.376], ['Nürnberg', 11.078, 49.452],
  ['Erfurt', 11.029, 50.978], ['Kiel', 10.123, 54.323], ['Rostock', 12.099, 54.092], ['Magdeburg', 11.628, 52.121],
  ['Saarbrücken', 6.997, 49.24], ['Kassel', 9.48, 51.313], ['Freiburg', 7.842, 47.999],
];
const tileStat = {};
let tilesDown = false, cityMarkers = null;
function checkTiles() {
  const b = state.basemap;
  const isDown = (id) => { const st = tileStat[id]; return !!st && st.ok === 0 && st.err >= 3; };
  const baseDown = b === 'sat' ? isDown('sat-blue') && isDown('sat-nasa') : isDown(b === 'osm' ? 'osm' : b === 'light' ? 'base-light' : 'base-dark');
  const labelsDown = b === 'osm' ? isDown('osm') : isDown(b === 'light' ? 'labels-light' : 'labels-dark');
  notice('tiles', baseDown ? 'Die Hintergrundkarte ist gerade nicht erreichbar. Gezeigt wird eine vereinfachte Karte aus den Ländergrenzen.' : '');
  // Fehlen die Beschriftungskacheln, zeichnet die Karte die Ortsnamen selbst (data/places.json)
  const want = labelsDown && b !== 'osm';
  if (want === tilesDown) return;
  tilesDown = want;
  drawPlaces();
}

/* ------------------------------------------------------------------ Ortsnamen */
// Orte ab 500 Einwohnern (GeoNames), nach Einwohnerzahl sortiert. Je weiter hineingezoomt,
// desto kleinere Orte erscheinen; ein Raster verhindert, dass sich Namen ueberdecken.
let places = null, placeBox = null, placeRaf = 0;
async function loadPlaces() {
  try {
    const res = await fetch('data/places.json');
    places = res.ok ? await res.json() : [];
  } catch (e) { places = []; }
  drawPlaces();
}
function drawPlaces() {
  if (!map) return;
  if (!placeBox) {
    placeBox = el('div', 'places');
    map.getCanvasContainer().append(placeBox);
    map.on('move', () => { if (!placeRaf) placeRaf = requestAnimationFrame(() => { placeRaf = 0; drawPlaces(); }); });
  }
  if (!tilesDown || !places || !places.length) { placeBox.textContent = ''; return; }
  const z = map.getZoom();
  const minPop = z < 5 ? 1e6 : z < 6 ? 400000 : z < 7 ? 150000 : z < 8 ? 50000 : z < 9 ? 20000 : z < 10 ? 8000 : z < 11 ? 3000 : 0;
  const bb = map.getBounds(), w0 = bb.getWest(), e0 = bb.getEast(), s0 = bb.getSouth(), n0 = bb.getNorth();
  const used = new Set(), frag = document.createDocumentFragment();
  let n = 0;
  for (let i = 0; i < places.length && n < 170; i++) {
    const p = places[i];
    if (p[3] < minPop) break;
    if (p[1] < w0 || p[1] > e0 || p[2] < s0 || p[2] > n0) continue;
    const pt = map.project([p[1], p[2]]);
    const gx = Math.floor(pt.x / 96), gy = Math.floor(pt.y / 24);
    if (used.has(`${gx},${gy}`) || used.has(`${gx + 1},${gy}`)) continue;
    used.add(`${gx},${gy}`); used.add(`${gx + 1},${gy}`);
    const d = el('div', `city place${p[3] >= 100000 ? ' big' : p[3] >= 20000 ? ' mid' : ''}`);
    d.style.transform = `translate(${Math.round(pt.x) - 3}px, ${Math.round(pt.y) - 8}px)`;
    d.append(el('span', 'city-dot'), el('span', null, p[0]));
    frag.append(d);
    n++;
  }
  placeBox.replaceChildren(frag);
}
function applyBasemap() {
  const b = state.basemap, th = THEMES[b];
  document.documentElement.dataset.theme = isLight(b) ? 'light' : 'dark';
  const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  vis('base-dark', b === 'dark');
  vis('osm', b === 'osm');
  vis('labels-dark', !isLight(b));
  vis('base-light', b === 'light');
  vis('labels-light', b === 'light');
  vis('sat-nasa', b === 'sat');
  vis('sat-blue', b === 'sat');
  map.setPaintProperty('bg', 'background-color', th.sea);
  if (map.getLayer('de-mask')) {
    map.setPaintProperty('de-land', 'fill-color', th.land);
    map.setPaintProperty('de-mask', 'fill-color', th.mask);
    map.setPaintProperty('de-states', 'line-color', th.line);
    map.setPaintProperty('de-outline', 'line-color', th.outline);
    map.setPaintProperty('de-sel', 'line-color', isLight(b) ? '#2a78d6' : '#3987e5');
  }
  updateSatDate(true);
  renderLegend();
  checkTiles();
  if (tl) tl.draw();
  map.triggerRepaint();
}
function updateSatDate() {
  const note = ui.satNote;
  if (state.basemap !== 'sat') { note.hidden = true; return; }
  note.hidden = false;
  note.textContent = 'Wolkenfreies Satellitenbild (Esri/Maxar). Unabhängig vom gewählten Zeitraum.';
}

/* ------------------------------------------------------------------ Oberflaeche */
function bindSeg(root, get, set) {
  const btns = [...root.querySelectorAll('button')];
  const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(get()))));
  btns.forEach((b) => b.addEventListener('click', () => { set(b.dataset.v); sync(); }));
  sync();
  return sync;
}
function buildUI() {
  ui.typeChips = GROUPS.map((g, gi) => {
    const b = el('button', 'chip'), sw = el('span', 'swatch'), n = el('span', 'n');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.groups[gi]));
    b.append(el('span', 'box'), sw, el('span', null, g.label), n);
    b.addEventListener('click', () => {
      state.groups[gi] = !state.groups[gi];
      b.setAttribute('aria-pressed', String(state.groups[gi]));
      filtersChanged();
    });
    $('#typeChips').append(b);
    return { n, sw };
  });
  ['Niedrig', 'Nominal', 'Hoch'].forEach((name, k) => {
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.conf[k]));
    b.append(el('span', 'box'), el('span', null, name));
    b.addEventListener('click', () => {
      state.conf[k] = !state.conf[k];
      b.setAttribute('aria-pressed', String(state.conf[k]));
      filtersChanged();
    });
    $('#confChips').append(b);
  });
  ui.srcRows = {};
  for (const s of data) {
    const meta = SOURCES[s.fam] || { label: s.fam, res: '' };
    const row = el('label', 'check'), cb = el('input'), n = el('span', 'n');
    cb.type = 'checkbox';
    cb.checked = true;
    const name = el('span');
    name.append(el('span', null, meta.label), el('span', 'res', meta.res ? `  ${meta.res}` : ''));
    row.append(cb, name, n);
    cb.addEventListener('change', () => { state.src[s.fam] = cb.checked; filtersChanged(); });
    $('#srcChecks').append(row);
    ui.srcRows[s.fam] = { n, row };
  }
  bindSeg($('#colorSeg'), () => state.color, (v) => { state.color = v; savePrefs(); renderLegend(); invalidate(UI); });
  bindSeg($('#dnSeg'), () => state.dn, (v) => { state.dn = Number(v); filtersChanged(); });
  bindSeg($('#baseSeg'), () => state.basemap, (v) => { state.basemap = v; savePrefs(); applyBasemap(); });
  $('#frpMin').addEventListener('input', (e) => {
    state.frpMin = Number(e.target.value);
    $('#frpMinOut').textContent = state.frpMin > 0 ? `ab ${state.frpMin} MW` : 'alle';
    filtersChanged();
  });

  const sel = $('#regionSel');
  sel.append(new Option('Grenzen werden geladen …', '-2'));
  sel.disabled = true;
  sel.addEventListener('change', () => selectRegion(Number(sel.value), true));
  ui.regionSel = sel;
  ui.rankRows = REGIONS.map((r, k) => {
    const b = el('button', 'rank'), n = el('span', 'n'), fill = el('span', 'fill');
    b.type = 'button';
    const track = el('span', 'track');
    track.append(fill);
    b.append(el('span', 'name', r[1]), n, track);
    b.addEventListener('click', () => selectRegion(state.region === k ? -1 : k, true));
    return { b, n, fill, k };
  });

  document.querySelectorAll('.tl-presets button').forEach((b) => b.addEventListener('click', () => { setPlaying(false); applyPreset(b.dataset.preset); }));
  const ys = $('#yearSel');
  const y0 = new Date(msOf(state.full0)).getUTCFullYear(), y1 = new Date(msOf(state.full1 - 1)).getUTCFullYear();
  for (let y = y1; y >= y0; y--) ys.append(new Option(String(y), String(y)));
  ys.addEventListener('change', () => {
    if (!ys.value) return;
    const y = Number(ys.value);
    setPlaying(false);
    setWindow(Math.max(state.full0, minOfDate(y, 0)), Math.min(state.full1, minOfDate(y + 1, 0)));
    state.preset = `y${y}`;
    revealWindow();
  });
  ui.yearSel = ys;
  $('#stepBack').addEventListener('click', () => { setPlaying(false); stepWindow(-1); });
  $('#stepFwd').addEventListener('click', () => { setPlaying(false); stepWindow(1); });
  ui.playBtn.addEventListener('click', () => setPlaying(!state.playing));
  $('#viewAll').addEventListener('click', () => setView(state.full0, state.full1));
  $('#statMaxBtn').addEventListener('click', () => {
    if (!stats || !stats.maxRef) return;
    const d = describe(stats.maxRef);
    showDetail(stats.maxRef);
    map.flyTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 9.5), padding: mapPadding() });
  });
  $('#panelToggle').addEventListener('click', () => {
    const closed = document.body.classList.toggle('panel-closed');
    $('#panelToggle').setAttribute('aria-expanded', String(!closed));
    requestAnimationFrame(() => { tl.resize(); invalidate(HIST); });
  });
  $('#tableBtn').addEventListener('click', openTable);
  $('#csvBtn').addEventListener('click', exportCsv);
  $('#tableClose').addEventListener('click', () => $('#tableDlg').close());
}
/* ------------------------------------------------------------------ Eigene Flaeche */
// Rechteck auf der Karte aufziehen. Solange es besteht, zeigen Karte, Kennzahlen, Zeitleiste,
// Kalender und CSV-Export nur Detektionen innerhalb dieser Flaeche (region -3).
function areaFeature(a) {
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a[0], a[1]], [a[2], a[1]], [a[2], a[3]], [a[0], a[3]], [a[0], a[1]]]] } };
}
function showArea(a) {
  const src = map.getSource('area');
  if (src) src.setData({ type: 'FeatureCollection', features: a ? [areaFeature(a)] : [] });
}
function areaText(a) {
  const f = (v, pos, neg) => `${nf2.format(Math.abs(v))}° ${v >= 0 ? pos : neg}`;
  return `${f(a[1], 'N', 'S')} bis ${f(a[3], 'N', 'S')}, ${f(a[0], 'O', 'W')} bis ${f(a[2], 'O', 'W')}`;
}
function setArea(a) {
  state.area = a;
  const sel = ui.regionSel;
  let opt = sel.querySelector('option[value="-3"]');
  if (a && !opt) { opt = new Option('Eigene Fläche', '-3'); sel.append(opt); }
  if (!a && opt) opt.remove();
  showArea(a);
  $('#areaClear').hidden = !a;
  $('#areaHint').textContent = a ? `Gewählt: ${areaText(a)}.` : 'Rechteck auf der Karte aufziehen; danach zählt nur, was darin liegt.';
  selectRegion(a ? -3 : (regions ? -1 : -2), false);
}
function bindAreaTool() {
  const btn = $('#areaDraw');
  let drawing = false, start = null;
  const stop = () => {
    drawing = false; start = null;
    document.body.classList.remove('drawing');
    btn.setAttribute('aria-pressed', 'false');
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
  };
  btn.addEventListener('click', () => {
    if (drawing) { stop(); showArea(state.area); return; }
    drawing = true;
    document.body.classList.add('drawing');
    btn.setAttribute('aria-pressed', 'true');
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    closeDetail();
  });
  $('#areaClear').addEventListener('click', () => setArea(null));
  const box = (a, b) => [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
  const down = (e) => { if (!drawing) return; e.preventDefault(); start = e.lngLat; };
  const move = (e) => { if (drawing && start) showArea(box(start, e.lngLat)); };
  const up = (e) => {
    if (!drawing || !start) return;
    const a = box(start, e.lngLat);
    stop();
    if (a[2] - a[0] < 0.01 || a[3] - a[1] < 0.01) { showArea(state.area); return; }   // nur ein Klick
    setArea(a);
  };
  map.on('mousedown', down); map.on('mousemove', move); map.on('mouseup', up);
  map.on('touchstart', down); map.on('touchmove', move); map.on('touchend', up);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawing) { stop(); showArea(state.area); } });
}

/* ------------------------------------------------------------------ CSV-Export */
// Alle Detektionen, die gerade gezeigt werden: Zeitfenster, Filter, Sensoren und Gebiet.
function exportCsv() {
  const out = ['latitude,longitude,acq_date,acq_time_utc,sensor,satellite,frp_mw,confidence_percent,confidence_class,daynight,source_type,data_quality,version'];
  const cls = ['low', 'nominal', 'high', ''];
  const typ = ['unclassified', 'vegetation_fire', 'volcano', 'static_land_source', 'offshore', 'static_derived', '', ''];
  let n = 0;
  for (const src of data) {
    if (!state.src[src.fam]) continue;
    const { f32, u16, u8 } = src;
    for (let i = src.a; i < src.b; i++) {
      if (!passes(src, i)) continue;
      const o = i * REC, flags = u8[o + 21];
      const d = new Date(EPOCH_MS + u16[i * 14 + 6] * 86400000).toISOString().slice(0, 10);
      const m = u16[i * 14 + 7];
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const frp = f32[i * 7 + 2];
      out.push([f32[i * 7 + 1].toFixed(5), f32[i * 7].toFixed(5), d, hhmm, src.fam, src.meta.sat[u8[o + 24]] || '',
        frp >= 0 ? frp.toFixed(2) : '', u8[o + 20] === 255 ? '' : u8[o + 20], cls[(flags >> 1) & 3],
        flags & 64 ? '' : (flags & 1 ? 'N' : 'D'), typ[(flags >> 3) & 7], flags & 128 ? 'NRT' : 'SP', src.meta.ver[u8[o + 25]] || ''].join(','));
      n++;
    }
  }
  const day = (t) => new Date(msOf(t)).toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `firms_hotspots_${day(state.t0)}_${day(state.t1 - 1)}_${n}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function selectRegion(r, fit) {
  state.region = r;
  ui.regionSel.value = String(r);
  if (map.getLayer('de-sel')) map.setFilter('de-sel', ['==', ['get', 'NUTS_ID'], r >= 0 ? REGIONS[r][0] : '']);
  filtersChanged();
  if (fit && regions && r !== -3) map.fitBounds(r >= 0 ? regions.bounds[r] : DE_BOUNDS, { padding: mapPadding(), maxZoom: 10, duration: 700 });
}
function regionsReady() {
  const sel = ui.regionSel;
  sel.textContent = '';
  sel.append(new Option('Deutschland', '-1'));
  REGIONS.forEach((r, k) => sel.append(new Option(r[1], String(k))));
  sel.append(new Option('Deutschland mit Grenzregion', '-2'));
  sel.disabled = false;
  addRegionLayers();
  selectRegion(-1, false);
}
function renderLegend() {
  const root = ui.legend, th = THEMES[state.basemap];
  root.textContent = '';
  ui.typeChips.forEach((c, gi) => { c.sw.hidden = state.color !== 'type'; c.sw.style.background = th.types[gi]; });
  if (state.color === 'type') {
    const keys = el('div', 'keys');
    for (const gi of LEGEND_ORDER) {
      const k = el('div', 'key'), sw = el('span', 'swatch');
      sw.style.background = th.types[gi];
      k.append(sw, el('span', null, GROUPS[gi].label));
      keys.append(k);
    }
    root.append(keys);
    return;
  }
  const frp = state.color === 'frp';
  root.append(el('div', 'legend-title', frp ? 'Strahlungsleistung je Detektion' : 'Zeitpunkt im gewählten Zeitraum'));
  const ramp = el('div', 'ramp');
  ramp.style.background = `linear-gradient(to right, ${th.ramp.join(', ')})`;
  const ticks = el('div', 'ramp-ticks');
  const labels = frp ? ['1 MW', '10', '100', '1.000 MW'] : [fmtDate(state.t0), fmtDate(state.t1 - 1)];
  for (const l of labels) ticks.append(el('span', null, l));
  root.append(ramp, ticks);
  root.append(el('p', 'hint', 'Größere Punkte bedeuten größere Strahlungsleistung.'));
  if (th.additive) root.append(el('p', 'hint', 'Wo sich viele Punkte überlagern, wird die Karte heller.'));
}
function renderUI() {
  if (!stats) return;
  const aligned = state.t0 % DAY === 0 && state.t1 % DAY === 0, len = state.t1 - state.t0;
  const a = aligned ? fmtDate(state.t0) : fmtDateTime(state.t0), b = aligned ? fmtDate(state.t1 - 1) : fmtDateTime(state.t1);
  const dur = len < DAY ? `${nf0.format(len / 60)} Std.` : len < 730 * DAY ? (len === DAY ? '1 Tag' : `${nf0.format(len / DAY)} Tage`) : `${nf1.format(len / DAY / 365.25)} Jahre`;
  ui.rangeText.textContent = a === b ? a : `${a} – ${b}`;
  ui.rangeText.append(el('small', null, `  ·  ${dur}`));

  ui.statCount.textContent = fmtCount(stats.count);
  ui.statFrp.textContent = stats.count ? fmtPower(stats.frp) : '–';
  ui.statMaxBtn.disabled = !stats.maxRef;
  if (stats.maxRef) {
    const d = describe(stats.maxRef);
    ui.statMax.textContent = fmtPower(d.frp);
    ui.statMaxNote.textContent = `${fmtDate(d.t)}${d.region < 16 ? ` · ${REGIONS[d.region][1]}` : ''} · anzeigen`;
  } else {
    ui.statMax.textContent = '–';
    ui.statMaxNote.textContent = stats.count ? '' : 'Keine Detektionen im gewählten Zeitraum';
  }
  ui.typeChips.forEach((c, gi) => { c.n.textContent = nf0.format(stats.byGroup[gi]); });
  for (const s of data) {
    const r = ui.srcRows[s.fam], n = stats.bySrc[s.fam] || 0;
    r.n.textContent = nf0.format(n);
    r.row.classList.toggle('empty', n === 0);
  }
  if (regions) {
    const max = Math.max(1, ...stats.byRegion);
    const rows = [...ui.rankRows].sort((p, q) => stats.byRegion[q.k] - stats.byRegion[p.k] || p.k - q.k);
    for (const r of rows) {
      const n = stats.byRegion[r.k];
      r.n.textContent = nf0.format(n);
      r.fill.style.width = `${(n / max) * 100}%`;
      r.b.classList.toggle('zero', n === 0);
      r.b.setAttribute('aria-pressed', String(state.region === r.k));
      ui.regionRanks.append(r.b);
    }
  }
  document.querySelectorAll('.tl-presets button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.preset === state.preset)));
  if (!(state.preset || '').startsWith('y')) ui.yearSel.value = '';
  if (state.color === 'time') renderLegend();
  updateSatDate(false);
}
function openTable() {
  if (!hist) return;
  const body = $('#tableEl tbody');
  body.textContent = '';
  const unit = { hour: 'Stunde', day: 'Tag', month: 'Monat', year: 'Jahr' }[hist.unit];
  $('#tableNote').textContent = `Je ${unit}, im sichtbaren Ausschnitt der Zeitleiste und mit den Filtern der Karte.`;
  for (let i = hist.counts.length - 1; i >= 0; i--) {
    const tr = el('tr');
    tr.append(el('td', null, binLabel(hist.unit, hist.edges[i])), el('td', 'num', nf0.format(hist.counts[i])));
    body.append(tr);
  }
  $('#tableDlg').showModal();
}
const notices = {};
function notice(key, text) {
  notices[key] = text;
  const n = $('#notice');
  n.textContent = '';
  for (const t of Object.values(notices)) if (t) n.append(el('div', null, t));
  n.hidden = !n.childElementCount;
}

/* ------------------------------------------------------------------ Start */
async function init() {
  Object.assign(ui, {
    tip: $('#tip'), legend: $('#legend'), satNote: $('#satNote'), rangeText: $('#rangeText'), timeline: $('#timeline'),
    detail: $('#detail'),
    statCount: $('#statCount'), statFrp: $('#statFrp'), statMax: $('#statMax'), statMaxNote: $('#statMaxNote'),
    statMaxBtn: $('#statMaxBtn'), playBtn: $('#playBtn'), playIcon: $('#playIcon'), regionRanks: $('#regionRanks'),
  });
  if (window.innerWidth <= 860) document.body.classList.add('panel-closed');
  document.documentElement.dataset.theme = isLight(state.basemap) ? 'light' : 'dark';
  const loading = $('#loading');
  const fail = (msg) => { loading.classList.add('error'); $('#loadingText').textContent = msg; };

  const res = await fetch('data/manifest.json', { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) { fail('Es sind noch keine Daten vorhanden. Bitte zuerst „aktualisieren.bat“ ausführen und die Seite neu laden.'); return; }
  manifest = await res.json();
  const entries = Object.entries(manifest.sources || {}).filter(([, s]) => s.n > 0);
  if (!entries.length) { fail('Die Datendateien sind leer. Bitte „aktualisieren.bat“ ausführen und die Seite neu laden.'); return; }

  const mapReady = initMap();
  const loaded = await Promise.all(entries.map(([fam, meta]) => loadSource(fam, meta, manifest.generated)));
  data.push(...loaded);
  let tMin = Infinity, tMax = 0, total = 0;
  for (const s of data) { state.src[s.fam] = true; tMin = Math.min(tMin, s.t[0]); tMax = Math.max(tMax, s.t[s.n - 1]); total += s.n; }
  state.full0 = Math.floor(tMin / DAY) * DAY;
  state.full1 = Math.floor(tMax / DAY) * DAY + DAY;
  state.v0 = state.full0;
  state.v1 = state.full1;
  state.t1 = state.full1;
  state.t0 = Math.max(state.full0, state.full1 - 365 * DAY);

  const stand = manifest.downloaded ? `${dfDate.format(new Date(manifest.downloaded))}, ${dfTime.format(new Date(manifest.downloaded))} UTC` : 'unbekannt';
  $('#dataStatus').textContent = `${fmtCount(total)} Detektionen vom ${fmtDate(state.full0)} bis ${fmtDate(state.full1 - 1)}. Abruf bei der NASA: ${stand}.`;
  if (manifest.missingMonths > 0) {
    notice('archive', `Das Archiv ist noch unvollständig: ${nf0.format(manifest.missingMonths)} Monatsdateien fehlen. Läuft der Download noch, danach „aktualisieren.bat“ ausführen und neu laden.`);
  }

  compileFilter();
  tl = createTimeline($('#tlCanvas'));
  buildUI();
  tl.resize();
  new ResizeObserver(() => { tl.resize(); invalidate(HIST); }).observe($('#tlCanvas'));
  renderLegend();

  const regionsLoad = loadRegions().then((r) => { regions = r; }).catch((e) => {
    console.warn(e);
    notice('regions', 'Die Landesgrenzen ließen sich nicht laden (Eurostat GISCO nicht erreichbar). Gezeigt wird das ganze Rechteck um Deutschland; die Auswahl nach Bundesland fehlt.');
    ui.regionSel.textContent = '';
    ui.regionSel.append(new Option('Rechteck um Deutschland', '-2'));
  });
  await Promise.race([regionsLoad, new Promise((r) => setTimeout(r, 7000))]);
  await mapReady;
  map.addLayer(fireLayer, 'labels-dark');
  loadPlaces();
  map.addSource('area', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.07 } });
  map.addLayer({ id: 'area-halo', type: 'line', source: 'area', paint: { 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.55 } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  bindAreaTool();
  applyBasemap();
  if (regions) regionsReady();
  else regionsLoad.then(() => { if (regions) regionsReady(); });
  invalidate(RANGES | STATS | HIST | UI);
  loading.classList.add('done');
  // Zugriff fuer die Browser-Konsole (Fehlersuche, eigene Auswertungen)
  window.feuerkarte = {
    state, data, map, setWindow, setView, pick, describe,
    get stats() { return stats; }, get hist() { return hist; },
    regionAt: (lon, lat) => { const r = regions ? regions.regionAt(lon, lat) : 255; return r < 16 ? REGIONS[r][1] : null; },
    regionIndex: (lon, lat) => (regions ? regions.regionAt(lon, lat) : 255),
  };
}
init().catch((e) => {
  console.error(e);
  $('#loading').classList.add('error');
  $('#loading').classList.remove('done');
  $('#loadingText').textContent = `Die Karte konnte nicht starten: ${e.message}`;
});
