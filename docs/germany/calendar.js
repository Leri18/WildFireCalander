/* Harmonisierter Brandkalender fuer die Feuerkarte.
   Daten: data/harm/meta.json, harm.bin, modis.bin (scripts/build_app_data.py --region Germany).
   Haengt sich ueber window.feuerkarte an die Karte: Gebiet lesen, Zeitfenster setzen. */
const $ = (s) => document.querySelector(s);
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MON_L = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const RAMPS = {
  dark: ['#3a1410', '#7d2414', '#d1401f', '#f1801e', '#fab02a', '#fddc58', '#fff7c2'],
  light: ['#fbe3c4', '#f3b46a', '#e06714', '#c22d24', '#a3182f', '#7d1036', '#3f0a2e'],
};
const EPOCH_MS = Date.UTC(2000, 0, 1);
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmt = (v) => (v >= 100 ? nf0.format(v) : nf1.format(v));
const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

let D = null;
const S = { mode: 'harm', t: null };
let R = null;

function ramp(u) {
  const stops = RAMPS[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
  const x = Math.min(1, Math.max(0, u)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const h = (c, k) => parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16);
  return `rgb(${[0, 1, 2].map((k) => Math.round(h(stops[i], k) + (h(stops[i + 1], k) - h(stops[i], k)) * f)).join(',')})`;
}

async function load() {
  const [meta, hb, mb] = await Promise.all([
    fetch('data/harm/meta.json').then((r) => { if (!r.ok) throw new Error('meta'); return r.json(); }),
    fetch('data/harm/harm.bin').then((r) => r.arrayBuffer()),
    fetch('data/harm/modis.bin').then((r) => r.arrayBuffer()),
  ]);
  const T = meta.months.length, N = meta.cells.length;
  const q = new Uint16Array(hb);
  const harm = new Float32Array(T * N);
  for (let i = 0; i < q.length; i++) { const r = q[i] / meta.k; harm[i] = r * r; }
  const raw = new Float32Array(harm);
  raw.set(new Uint16Array(mb), 0);
  const lat = new Float32Array(N), lon = new Float32Array(N);
  meta.cells.forEach((code, i) => {
    lat[i] = meta.lat0 + (Math.floor(code / meta.width) + 0.5) * meta.grid;
    lon[i] = meta.lon0 + ((code % meta.width) + 0.5) * meta.grid;
  });
  D = { meta, T, N, harm, raw, lat, lon,
    year: meta.months.map((m) => +m.slice(0, 4)), cal: meta.months.map((m) => +m.slice(5, 7) - 1) };
}

function regionName(r) {
  if (r === -2) return 'Deutschland mit Grenzregion';
  if (r === -1) return 'Deutschland';
  if (r === -3) return 'Eigene Fläche';
  const opt = $('#regionSel').querySelector(`option[value="${r}"]`);
  return opt ? opt.textContent : 'Gebiet';
}

function compute() {
  const fk = window.feuerkarte;
  const r = fk.state.region;
  const idx = [];
  for (let i = 0; i < D.N; i++) {
    if (r === -2) { idx.push(i); continue; }
    if (r === -3) { const a = fk.state.area; if (a && D.lon[i] >= a[0] && D.lon[i] <= a[2] && D.lat[i] >= a[1] && D.lat[i] <= a[3]) idx.push(i); continue; }
    const k = fk.regionIndex(D.lon[i], D.lat[i]);
    if (r === -1 ? k < 16 : k === r) idx.push(i);
  }
  const vals = S.mode === 'harm' ? D.harm : D.raw;
  const series = new Float64Array(D.T);
  for (let t = 0; t < D.T; t++) { let s = 0; const o = t * D.N; for (const i of idx) s += vals[o + i]; series[t] = s; }
  const byCal = Array.from({ length: 12 }, () => []);
  for (let t = 0; t < D.T; t++) byCal[D.cal[t]].push(t);
  const med = byCal.map((ts) => median(ts.map((t) => series[t])));
  let hi = 0;
  for (let t = 0; t < D.T; t++) if (series[t] > hi) hi = series[t];
  R = { r, idx, series, byCal, med, hi: Math.max(hi, 1), lo: Math.max(0.5, hi / 2000) };
}

function sourceOf(t) {
  if (t >= D.meta.n_modeled) return 'beobachtet von VIIRS (Suomi NPP)';
  const terra = D.meta.months[t] <= D.meta.terra_only_until;
  if (S.mode === 'raw') return terra ? 'MODIS (nur Terra), Rohzählung' : 'MODIS (Terra und Aqua), Rohzählung';
  return terra ? 'aus MODIS (nur Terra) umgerechnet' : 'aus MODIS (Terra und Aqua) umgerechnet';
}

function drawGrid() {
  const grid = $('#calGrid');
  const f = document.createDocumentFragment();
  f.append(el('div', 'cg-head', ''));
  MON.forEach((m) => f.append(el('div', 'cg-head', m)));
  f.append(el('div', 'cg-head cg-sum', 'Jahr'));
  const y0 = D.year[0], y1 = D.year[D.T - 1];
  for (let y = y0; y <= y1; y++) {
    f.append(el('div', 'cg-year', String(y)));
    let total = 0, n = 0;
    for (let m = 0; m < 12; m++) {
      const t = D.meta.months.indexOf(`${y}-${String(m + 1).padStart(2, '0')}`);
      const b = el('button', 'cg-cell');
      b.type = 'button';
      if (t < 0) { b.disabled = true; b.classList.add('is-void'); b.setAttribute('aria-label', `${MON_L[m]} ${y}: keine Daten`); }
      else {
        const v = R.series[t];
        total += v; n++;
        if (v >= R.lo) b.style.background = ramp(Math.log(v / R.lo) / Math.log(R.hi / R.lo));
        if (t < D.meta.n_modeled && S.mode === 'harm') b.classList.add('is-model');
        if (t === S.t) b.classList.add('is-picked');
        b.dataset.t = t;
        b.title = `${MON_L[m]} ${y}: ${fmt(v)}`;
        b.setAttribute('aria-label', `${MON_L[m]} ${y}: ${fmt(v)} Detektionen`);
      }
      f.append(b);
    }
    f.append(el('div', 'cg-sum', n === 12 ? fmt(total) : `${fmt(total)} (${n} Mon.)`));
  }
  f.append(el('div', 'cg-year', 'Median'));
  R.med.forEach((v) => f.append(el('div', 'cg-med', isFinite(v) ? fmt(v) : '')));
  f.append(el('div', 'cg-sum', ''));
  grid.replaceChildren(f);
}

function drawReading() {
  const t = S.t !== null ? S.t : D.T - 1;
  const m = D.cal[t], v = R.series[t], md = R.med[m];
  const peers = R.byCal[m];
  const rank = peers.filter((p) => R.series[p] > v).length + 1;
  const box = $('#calRead');
  const head = S.t !== null ? 'Gewählter Monat' : 'Jüngster vollständiger Monat';
  let verdict;
  if (!(md > 0)) verdict = `In einem typischen ${MON_L[m]} gibt es hier keine Detektionen (Median 0).`;
  else {
    const pct = Math.abs(Math.round((v / md - 1) * 100));
    const word = v > md ? 'über' : v < md ? 'unter' : 'auf';
    verdict = `<span class="cal-tag ${v > md ? 'up' : 'down'}">${word} dem Median</span> ${pct} % ${v > md ? 'mehr' : 'weniger'} als in einem typischen ${MON_L[m]} (Median ${fmt(md)}). Rang ${rank} von ${peers.length}.`;
  }
  box.innerHTML = `<p class="cal-when">${head}: ${MON_L[m]} ${D.year[t]}</p><p class="cal-big">${fmt(v)}</p>` +
    `<p class="cal-unit">${S.mode === 'harm' ? 'VIIRS-äquivalente Detektionen' : 'Detektionen, wie vom Sensor geliefert'}</p>` +
    `<p class="cal-verdict">${verdict}</p><p class="hint">Quelle: ${sourceOf(t)}.</p>`;
  $('#calShow').textContent = `${MON_L[m]} ${D.year[t]} auf der Karte zeigen`;
  $('#calShow').dataset.t = t;
}

function drawNotes() {
  const v = D.meta.validation, m = v.methods, c = m[v.chosen];
  $('#calNote').textContent = S.mode === 'harm'
    ? 'Jeder Monat steht in VIIRS-äquivalenten Detektionen. Monate mit Punkt sind aus MODIS umgerechnet, ab Februar 2012 zählt VIIRS selbst.'
    : `Rohzählung: bis Januar 2012 MODIS, danach VIIRS. VIIRS meldet hier rund ${nf1.format(v.snpp_over_modis)}-mal so viele Detektionen, deshalb wirken die oberen Zeilen ruhiger, als sie waren.`;
  $('#calCheck').textContent = `Geprüft an den Jahren 2012–2025, jeweils ein Jahr zurückgehalten: Die Umrechnung (ein Faktor je Kalendermonat) verfehlt die Monatssumme im Mittel um ${fmt(c.mae)} Detektionen bei typisch ${fmt(v.mean_monthly_snpp)} pro Monat und trifft „über oder unter dem Median“ in ${Math.round(c.median_agreement * 100)} % der Monate. ` +
    'In Deutschland sieht MODIS nur wenige Vegetationsbrände; die Werte vor 2012 sind deshalb grobe Schätzungen. Gezählt werden Vegetationsbrände aller Konfidenzstufen im 0,25°-Raster; kleine Länder bestehen aus wenigen Zellen. November 2026 ist unvollständig und fehlt.';
}

function render() {
  compute();
  $('#calTitle').textContent = `Harmonisierter Brandkalender · ${regionName(R.r)}`;
  $('#calHarm').setAttribute('aria-pressed', String(S.mode === 'harm'));
  $('#calRaw').setAttribute('aria-pressed', String(S.mode === 'raw'));
  drawGrid();
  drawReading();
  drawNotes();
}

async function open() {
  const dlg = $('#calDlg');
  if (!D) {
    try { await load(); } catch (e) {
      $('#calTitle').textContent = 'Harmonisierter Brandkalender';
      $('#calNote').textContent = 'Die Kalenderdaten fehlen (data/harm). Bitte scripts/build_app_data.py ausführen.';
      dlg.showModal();
      return;
    }
  }
  render();
  dlg.showModal();
}

function bind() {
  $('#calBtn').addEventListener('click', open);
  $('#calClose').addEventListener('click', () => $('#calDlg').close());
  $('#calHarm').addEventListener('click', () => { S.mode = 'harm'; render(); });
  $('#calRaw').addEventListener('click', () => { S.mode = 'raw'; render(); });
  $('#calGrid').addEventListener('click', (ev) => {
    const b = ev.target.closest('.cg-cell[data-t]');
    if (!b) return;
    const t = +b.dataset.t;
    S.t = S.t === t ? null : t;
    render();
  });
  $('#calShow').addEventListener('click', (ev) => {
    const t = +ev.currentTarget.dataset.t;
    const y = D.year[t], m = D.cal[t];
    const a = (Date.UTC(y, m, 1) - EPOCH_MS) / 60000, b = (Date.UTC(y, m + 1, 1) - EPOCH_MS) / 60000;
    window.feuerkarte.setWindow(a, b);
    $('#calDlg').close();
  });
}

function whenReady() {
  if (window.feuerkarte && window.feuerkarte.regionIndex) { $('#calBtn').disabled = false; return; }
  setTimeout(whenReady, 300);
}
bind();
whenReady();
