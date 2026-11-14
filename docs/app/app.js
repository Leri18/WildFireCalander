/* Wildfire Calendar: static app, no dependencies.
   Data: app/data/meta.json, harm.bin, modis.bin (built by scripts/build_app_data.py)
   and borders.json (Natural Earth outlines). */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  // cividis, 10 stops (colour-blind-safe, light to dark monotonic)
  const CIVIDIS = ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74",
    "#c3b369", "#e1cc55", "#fee838"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const MAP_DOMAIN = [0.5, 2000];          // hot spots per cell and month, fixed so months compare
  const VIEW = { w: -75.6, e: -52.4, s: -56.2, n: -20.8, phi0: -38.5 };
  const CITIES = [
    ["Buenos Aires", -34.61, -58.38, "l"], ["Córdoba", -31.42, -64.18, "r"], ["Rosario", -32.95, -60.65, "r"],
    ["Mendoza", -32.89, -68.84, "l"], ["Tucumán", -26.82, -65.22, "l"], ["Corrientes", -27.47, -58.83, "r"],
    ["Neuquén", -38.95, -68.06, "l"], ["Bariloche", -41.13, -71.31, "r"], ["Ushuaia", -54.8, -68.3, "r"],
  ];

  const S = { mode: "harm", bbox: null, y0: 0, y1: 0, t: null };
  let D = null;       // loaded data
  let R = null;       // derived results for the current state
  let hoverCell = -1;
  let drag = null;

  const fmt = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100)
    .toLocaleString("en-US");
  const fmtK = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "k"
    : v >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v)));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const degLat = (v) => `${Math.abs(v).toFixed(2).replace(/\.?0+$/, "")}°${v < 0 ? "S" : "N"}`;
  const degLon = (v) => `${Math.abs(v).toFixed(2).replace(/\.?0+$/, "")}°${v < 0 ? "W" : "E"}`;
  const median = (a) => {
    if (!a.length) return NaN;
    const s = Float64Array.from(a).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function lut(u) {
    const start = parseFloat(css("--lut-start")) || 0;
    const x = Math.min(1, Math.max(0, start + (1 - start) * u)) * (CIVIDIS.length - 1);
    const i = Math.min(CIVIDIS.length - 2, Math.floor(x));
    const f = x - i;
    const c = CIVIDIS[i].map((a, k) => Math.round(a + (CIVIDIS[i + 1][k] - a) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const logU = (v, lo, hi) => Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo);

  // ------------------------------------------------------------------ load
  async function load() {
    const [meta, borders, hb, mb] = await Promise.all([
      fetch("app/data/meta.json").then((r) => r.json()),
      fetch("app/data/borders.json").then((r) => r.json()),
      fetch("app/data/harm.bin").then((r) => r.arrayBuffer()),
      fetch("app/data/modis.bin").then((r) => r.arrayBuffer()),
    ]);
    const T = meta.months.length;
    const N = meta.cells.length;
    const q = new Uint16Array(hb);
    const harm = new Float32Array(T * N);
    for (let i = 0; i < q.length; i++) { const r = q[i] / meta.k; harm[i] = r * r; }
    const raw = new Float32Array(harm);
    raw.set(new Uint16Array(mb), 0);               // modeled months: MODIS counts as delivered
    const lat = new Float32Array(N);
    const lon = new Float32Array(N);
    meta.cells.forEach((code, i) => {
      lat[i] = meta.lat0 + Math.floor(code / meta.width) * meta.grid;   // south edge
      lon[i] = meta.lon0 + (code % meta.width) * meta.grid;             // west edge
    });
    const year = meta.months.map((m) => +m.slice(0, 4));
    const cal = meta.months.map((m) => +m.slice(5, 7) - 1);
    D = { meta, borders, T, N, harm, raw, lat, lon, year, cal,
      extent: { s: Math.min(...lat), n: Math.max(...lat) + meta.grid, w: Math.min(...lon), e: Math.max(...lon) + meta.grid } };
    S.y0 = year[0];
    S.y1 = year[T - 1];
  }

  // ------------------------------------------------------------------ compute
  function compute() {
    const { T, N, lat, lon, year, cal, meta } = D;
    const vals = S.mode === "harm" ? D.harm : D.raw;
    const g = meta.grid;
    const b = S.bbox;
    const idx = [];
    for (let i = 0; i < N; i++) {
      const cy = lat[i] + g / 2;
      const cx = lon[i] + g / 2;
      if (!b || (cy > b.s && cy < b.n && cx > b.w && cx < b.e)) idx.push(i);
    }
    const series = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let s = 0;
      const o = t * N;
      for (let k = 0; k < idx.length; k++) s += vals[o + idx[k]];
      series[t] = s;
    }
    const inRange = [];
    for (let t = 0; t < T; t++) if (year[t] >= S.y0 && year[t] <= S.y1) inRange.push(t);
    const byCal = Array.from({ length: 12 }, () => []);
    inRange.forEach((t) => byCal[cal[t]].push(t));
    const med = byCal.map((ts) => median(ts.map((t) => series[t])));
    const years = [];
    for (let y = S.y0; y <= S.y1; y++) {
      const ts = inRange.filter((t) => year[t] === y);
      years.push({ y, ts, total: ts.reduce((a, t) => a + series[t], 0), full: ts.length === 12 });
    }
    const fullYears = years.filter((r) => r.full);
    const yearMean = fullYears.length ? fullYears.reduce((a, r) => a + r.total, 0) / fullYears.length : NaN;
    let lo = Infinity;
    let hi = 0;
    let tMax = inRange[0];
    inRange.forEach((t) => {
      const v = series[t];
      if (v > 0 && v < lo) lo = v;
      if (v > hi) { hi = v; tMax = t; }
    });
    if (!(hi > 0)) { lo = 1; hi = 10; }
    lo = Math.max(lo, hi / 1e4, 0.1);
    if (hi / lo < 4) lo = hi / 4;
    // map layer: selected month, or mean per month over the selected years
    const tShow = S.t !== null && year[S.t] >= S.y0 && year[S.t] <= S.y1 ? S.t : null;
    const layer = new Float32Array(N);
    if (tShow !== null) {
      layer.set(vals.subarray(tShow * N, tShow * N + N));
    } else {
      inRange.forEach((t) => { const o = t * N; for (let i = 0; i < N; i++) layer[i] += vals[o + i]; });
      for (let i = 0; i < N; i++) layer[i] /= inRange.length;
    }
    R = { vals, idx, series, inRange, byCal, med, years, fullYears, yearMean, lo, hi, tMax, tShow, layer };
  }

  // ------------------------------------------------------------------ map
  const map = { cv: null, ctx: null, w: 0, h: 0, pad: { l: 40, r: 10, t: 12, b: 26 }, kx: 0, ky: 0 };
  const X = (lon) => map.pad.l + (lon - VIEW.w) * map.kx;
  const Y = (lat) => map.pad.t + (VIEW.n - lat) * map.ky;
  const invX = (px) => VIEW.w + (px - map.pad.l) / map.kx;
  const invY = (py) => VIEW.n - (py - map.pad.t) / map.ky;

  function sizeMap() {
    const cv = $("map");
    const w = cv.parentElement.clientWidth;
    const plotW = w - map.pad.l - map.pad.r;
    const k = Math.cos((VIEW.phi0 * Math.PI) / 180);
    map.kx = plotW / (VIEW.e - VIEW.w);
    map.ky = map.kx / k;
    const h = Math.round(map.pad.t + map.pad.b + (VIEW.n - VIEW.s) * map.ky);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = `${h}px`;
    map.cv = cv; map.w = w; map.h = h;
    map.ctx = cv.getContext("2d");
    map.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pathCountry(ctx, name) {
    ctx.beginPath();
    (D.borders.countries[name] || []).forEach((ring) => {
      ring.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la))));
      ctx.closePath();
    });
  }

  function drawMap() {
    const ctx = map.ctx;
    const { pad, w, h } = map;
    const g = D.meta.grid;
    const ink = css("--ink"), ink2 = css("--ink-2"), rule = css("--rule"), pick = css("--pick");
    const px0 = pad.l, py0 = pad.t, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();
    ctx.fillStyle = css("--sea"); ctx.fillRect(px0, py0, pw, ph);
    ctx.fillStyle = css("--land");
    ["Chile", "Uruguay", "Paraguay", "Bolivia", "Brazil", "Peru", "Falkland Is."].forEach((n) => { pathCountry(ctx, n); ctx.fill(); });
    ctx.fillStyle = css("--home"); pathCountry(ctx, "Argentina"); ctx.fill();
    // graticule, every 5 degrees
    ctx.strokeStyle = rule; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
    for (let la = -55; la <= -25; la += 5) { ctx.beginPath(); ctx.moveTo(px0, Y(la)); ctx.lineTo(px0 + pw, Y(la)); ctx.stroke(); }
    for (let lo = -75; lo <= -55; lo += 5) { ctx.beginPath(); ctx.moveTo(X(lo), py0); ctx.lineTo(X(lo), py0 + ph); ctx.stroke(); }
    ctx.setLineDash([]);
    // cells
    const cw = g * map.kx + 0.4, ch = g * map.ky + 0.4;
    for (let i = 0; i < D.N; i++) {
      const v = R.layer[i];
      if (v < MAP_DOMAIN[0]) continue;
      ctx.fillStyle = lut(logU(Math.min(v, MAP_DOMAIN[1]), MAP_DOMAIN[0], MAP_DOMAIN[1]));
      ctx.fillRect(X(D.lon[i]), Y(D.lat[i] + g), cw, ch);
    }
    // borders
    ctx.lineJoin = "round";
    ctx.strokeStyle = rule; ctx.lineWidth = 0.8;
    ["Chile", "Uruguay", "Paraguay", "Bolivia", "Brazil", "Peru"].forEach((n) => { pathCountry(ctx, n); ctx.stroke(); });
    ctx.strokeStyle = ink; ctx.lineWidth = 1.1; pathCountry(ctx, "Argentina"); ctx.stroke();
    // cities
    ctx.font = `400 10px ${css("--data")}`; ctx.textBaseline = "middle";
    CITIES.forEach(([name, la, lo, side]) => {
      const x = X(lo), y = Y(la);
      ctx.fillStyle = css("--sheet"); ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = side === "l" ? "right" : "left";
      const tx = x + (side === "l" ? -6 : 6);
      ctx.lineWidth = 3; ctx.strokeStyle = css("--home"); ctx.strokeText(name, tx, y);
      ctx.fillStyle = ink; ctx.fillText(name, tx, y);
    });
    // selection: dim the outside, outline the box
    const b = drag ? drag.box : S.bbox;
    if (b) {
      const x0 = X(b.w), x1 = X(b.e), y0 = Y(b.n), y1 = Y(b.s);
      ctx.fillStyle = css("--sea"); ctx.globalAlpha = 0.62;
      ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      ctx.strokeStyle = css("--sheet"); ctx.lineWidth = 4; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = pick; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (hoverCell >= 0 && !drag) {
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(X(D.lon[hoverCell]), Y(D.lat[hoverCell] + g), g * map.kx, g * map.ky);
    }
    // scale bar, 500 km along a meridian-independent east-west line at phi0
    const kmPerPx = (111.32 * Math.cos((VIEW.phi0 * Math.PI) / 180)) / map.kx;
    const barPx = 500 / kmPerPx;
    const bx = px0 + pw - barPx - 12, by = py0 + ph - 14;
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.lineTo(bx + barPx, by - 4); ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText("500 km", bx + barPx / 2, by - 3);
    ctx.restore();
    // frame and margin labels
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = ink2; ctx.font = `400 10px ${css("--data")}`;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let la = -55; la <= -25; la += 5) {
      ctx.fillText(`${-la}°S`, px0 - 6, Y(la));
      ctx.beginPath(); ctx.moveTo(px0 - 3, Y(la)); ctx.lineTo(px0, Y(la)); ctx.strokeStyle = ink; ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let lo = -75; lo <= -55; lo += 5) {
      ctx.fillText(`${-lo}°W`, X(lo), py0 + ph + 7);
      ctx.beginPath(); ctx.moveTo(X(lo), py0 + ph); ctx.lineTo(X(lo), py0 + ph + 3); ctx.stroke();
    }
    const what = R.tShow !== null
      ? `${MONTHS_LONG[D.cal[R.tShow]]} ${D.year[R.tShow]}`
      : `mean month, ${S.y0}${S.y1 > S.y0 ? "–" + S.y1 : ""}`;
    $("map-caption").textContent = `Shown: ${what} · ${S.mode === "harm" ? "harmonized" : "raw sensor counts"}`;
  }

  function drawLegend(cv) {
    const w = cv.clientWidth || 300;
    cv.width = w;
    const ctx = cv.getContext("2d");
    for (let x = 0; x < w; x++) { ctx.fillStyle = lut(x / (w - 1)); ctx.fillRect(x, 0, 1, 10); }
  }

  function cellAt(px, py) {
    const lo = invX(px), la = invY(py), g = D.meta.grid;
    const code = Math.floor((la - D.meta.lat0) / g) * D.meta.width + Math.floor((lo - D.meta.lon0) / g);
    if (lo < D.meta.lon0 || lo >= D.meta.lon0 + D.meta.width * g || la < D.meta.lat0) return -1;
    let a = 0, z = D.N - 1;
    while (a <= z) { const m = (a + z) >> 1; const c = D.meta.cells[m]; if (c === code) return m; if (c < code) a = m + 1; else z = m - 1; }
    return -1;
  }

  function snapBox(lo0, la0, lo1, la1) {
    const g = D.meta.grid, ex = D.extent;
    const cl = (v, a, b) => Math.min(b, Math.max(a, v));
    const w = cl(Math.floor(Math.min(lo0, lo1) / g) * g, ex.w, ex.e - g);
    const e = cl(Math.ceil(Math.max(lo0, lo1) / g) * g, w + g, ex.e);
    const s = cl(Math.floor(Math.min(la0, la1) / g) * g, ex.s, ex.n - g);
    const n = cl(Math.ceil(Math.max(la0, la1) / g) * g, s + g, ex.n);
    return { w, e, s, n };
  }

  function bindMap() {
    const cv = $("map");
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    cv.addEventListener("pointerdown", (ev) => {
      const [x, y] = pos(ev);
      drag = { x, y, moved: false, box: null };
      cv.setPointerCapture(ev.pointerId);
      hideTip();
    });
    cv.addEventListener("pointermove", (ev) => {
      const [x, y] = pos(ev);
      if (drag) {
        if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 5) drag.moved = true;
        if (drag.moved) { drag.box = snapBox(invX(drag.x), invY(drag.y), invX(x), invY(y)); drawMap(); }
        return;
      }
      const c = cellAt(x, y);
      if (c !== hoverCell) { hoverCell = c; drawMap(); }
      if (c >= 0) {
        const g = D.meta.grid;
        const v = R.layer[c];
        showTip(ev.clientX, ev.clientY, `<b>${fmt(v)} hot spots</b><i>${degLat(D.lat[c] + g / 2)}, ${degLon(D.lon[c] + g / 2)}</i><br><i>${R.tShow !== null ? D.meta.months[R.tShow] : "mean per month"}</i>`);
      } else hideTip();
    });
    const end = () => {
      if (drag && drag.moved && drag.box) { S.bbox = drag.box; drag = null; update(); } else { drag = null; drawMap(); }
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", () => { drag = null; drawMap(); });
    cv.addEventListener("pointerleave", () => { if (!drag) { hoverCell = -1; hideTip(); drawMap(); } });
  }

  // ------------------------------------------------------------------ tooltip
  function showTip(x, y, html) {
    const tip = $("tip");
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  }
  function hideTip() { $("tip").hidden = true; }

  // ------------------------------------------------------------------ calendar
  function sourceOf(t) {
    if (t >= D.meta.n_modeled) return "observed by VIIRS S-NPP";
    if (S.mode === "raw") return D.meta.months[t] <= D.meta.terra_only_until ? "MODIS Terra, as delivered" : "MODIS Terra + Aqua, as delivered";
    return D.meta.months[t] <= D.meta.terra_only_until ? "modeled from MODIS Terra" : "modeled from MODIS Terra + Aqua";
  }

  function drawCalendar() {
    const grid = $("grid");
    const f = document.createDocumentFragment();
    const add = (cls, text) => { const d = document.createElement("div"); d.className = cls; if (text !== undefined) d.textContent = text; f.appendChild(d); return d; };
    add("g-head", "");
    MONTHS.forEach((m) => add("g-head", m));
    add("g-head g-bar", "Year total");
    const maxYear = Math.max(...R.years.map((r) => r.total), 1);
    const scale = 0.62;                         // share of the bar column used by the longest bar
    R.years.forEach((row) => {
      add("g-year", String(row.y));
      for (let m = 0; m < 12; m++) {
        const t = row.ts.find((tt) => D.cal[tt] === m);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "g-cell";
        if (t === undefined) {
          b.classList.add("is-void"); b.disabled = true; b.setAttribute("aria-label", `${MONTHS_LONG[m]} ${row.y}: no data`);
        } else {
          const v = R.series[t];
          if (v > 0) b.style.background = lut(logU(v, R.lo, R.hi));
          if (t < D.meta.n_modeled && S.mode === "harm") b.classList.add("is-model");
          if (t === S.t) b.classList.add("is-picked");
          b.dataset.t = t;
          b.setAttribute("aria-label", `${MONTHS_LONG[m]} ${row.y}: ${fmt(v)} hot spots`);
        }
        f.appendChild(b);
      }
      const bar = add("g-bar");
      const el = document.createElement("span");
      el.className = `bar ${row.full ? (row.total >= R.yearMean ? "hot" : "cold") : "part"}`;
      el.style.width = `${(row.total / maxYear) * scale * 100}%`;
      bar.appendChild(el);
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = row.full ? fmtK(row.total) : `${fmtK(row.total)} (${row.ts.length} mo)`;
      bar.appendChild(val);
      if (row.full && isFinite(R.yearMean)) {
        const rule = document.createElement("span");
        rule.className = "mean-rule";
        rule.style.left = `calc(8px + ${(R.yearMean / maxYear) * scale} * (100% - 8px))`;
        bar.appendChild(rule);
        bar.title = `${row.y}: ${fmt(row.total)} hot spots, ${row.total >= R.yearMean ? "+" : ""}${Math.round((row.total / R.yearMean - 1) * 100)} % against the mean year`;
      } else {
        bar.title = `${row.y}: ${row.ts.length} of 12 months in the record, not compared with the mean`;
      }
    });
    // seasonal profile under the columns
    add("g-year", "");
    const maxMed = Math.max(...R.med.filter(isFinite), 1e-9);
    const peak = R.med.indexOf(Math.max(...R.med.filter(isFinite)));
    R.med.forEach((v, m) => {
      const c = add(`g-season${m === peak ? " is-peak" : ""}`);
      const col = document.createElement("span");
      col.className = "col";
      col.style.height = `${isFinite(v) ? Math.max(1, (v / maxMed) * 44) : 0}px`;
      c.appendChild(col);
      const lab = document.createElement("span");
      lab.textContent = isFinite(v) ? fmtK(v) : "";
      lab.style.textAlign = "center";
      c.appendChild(lab);
      c.title = `${MONTHS_LONG[m]}: median ${isFinite(v) ? fmt(v) : "n/a"} hot spots`;
    });
    const note = add("g-foot g-note");
    note.textContent = isFinite(R.yearMean) ? `Line: mean year, ${fmtK(R.yearMean)}` : "";
    const foot = add("g-foot");
    foot.style.gridColumn = "2 / 14";
    foot.textContent = `Columns below the table: median of each calendar month, ${S.y0}–${S.y1}.`;
    grid.replaceChildren(f);

    const ticks = $("cal-ticks");
    ticks.replaceChildren(...[R.lo, Math.sqrt(R.lo * R.hi), R.hi].map((v) => { const s = document.createElement("span"); s.textContent = fmtK(v); return s; }));
    drawLegend($("cal-legend"));
  }

  function bindCalendar() {
    const grid = $("grid");
    grid.addEventListener("click", (ev) => {
      const b = ev.target.closest(".g-cell[data-t]");
      if (!b) return;
      const t = +b.dataset.t;
      S.t = S.t === t ? null : t;
      update();
    });
    grid.addEventListener("pointermove", (ev) => {
      const b = ev.target.closest(".g-cell[data-t]");
      if (!b) { hideTip(); return; }
      const t = +b.dataset.t;
      const v = R.series[t];
      const md = R.med[D.cal[t]];
      const rel = md > 0 ? `${v >= md ? "+" : ""}${Math.round((v / md - 1) * 100)} % vs median ${MONTHS[D.cal[t]]}` : "";
      showTip(ev.clientX, ev.clientY, `<b>${MONTHS[D.cal[t]]} ${D.year[t]} · ${fmt(v)}</b><i>${rel}</i><br><i>${sourceOf(t)}</i>`);
    });
    grid.addEventListener("pointerleave", hideTip);
  }

  // ------------------------------------------------------------------ reading
  function drawReading() {
    const t = R.tShow !== null ? R.tShow : R.inRange[R.inRange.length - 1];
    const m = D.cal[t];
    const v = R.series[t];
    const peers = R.byCal[m];
    const md = R.med[m];
    const rank = peers.filter((p) => R.series[p] > v).length + 1;
    const up = v > md;
    const ratio = md > 0 ? v / md : NaN;
    const unit = S.mode === "harm" ? "VIIRS-equivalent hot spots" : "hot spots as delivered by the sensor";
    let verdict;
    if (!(md > 0)) verdict = "No fire activity was recorded in this calendar month in the selected years.";
    else if (peers.length < 3) verdict = `Only ${peers.length} ${MONTHS_LONG[m]} months are in the selected years, too few for a median.`;
    else {
      const pct = Math.abs(Math.round((ratio - 1) * 100));
      verdict = `<span class="tag ${up ? "up" : "down"}">${up ? "above" : v === md ? "at" : "below"} median</span>` +
        `<b>${pct} % ${up ? "more" : "less"}</b> than a typical ${MONTHS_LONG[m]} (median ${fmt(md)}, ${S.y0}–${S.y1}). ` +
        `Rank ${rank} of ${peers.length} ${MONTHS_LONG[m]} months.`;
    }
    let fine = `Source: ${sourceOf(t)}.`;
    if (S.mode === "harm" && t < D.meta.n_modeled) {
      fine += !S.bbox
        ? ` 90 % range for the whole country: ${fmt(D.meta.country.lower[t])} to ${fmt(D.meta.country.upper[t])}.`
        : " No uncertainty range is available for part of the country.";
    }
    const lead = R.tShow !== null ? "Selected month" : "Latest month in the selected years";
    const maxPeer = Math.max(...peers.map((p) => R.series[p]), v, 1e-9);
    const pos = (x) => `${(x / maxPeer) * 100}%`;
    const strip = peers.length >= 3 ? `<div class="medbar" role="img" aria-label="All ${MONTHS_LONG[m]} months compared">` +
      peers.map((p) => `<span class="dot" style="left:${pos(R.series[p])}"></span>`).join("") +
      `<span class="med" style="left:${pos(md)}"></span><span class="now" style="left:${pos(v)}"></span></div>` +
      `<div class="medbar-key"><span>0</span><span>every ${MONTHS_LONG[m]}, dashed = median</span><span>${fmtK(maxPeer)}</span></div>` : "";
    $("month-read").innerHTML = `<p class="when">${lead} · ${MONTHS_LONG[m]} ${D.year[t]}</p>` +
      `<p class="big">${fmt(v)}</p><p class="unit">${unit}</p><p class="verdict">${verdict}</p>${strip}<p class="fine">${fine}</p>`;

    const topYear = R.fullYears.slice().sort((a, b) => b.total - a.total)[0];
    const lowYear = R.fullYears.slice().sort((a, b) => a.total - b.total)[0];
    const peak = R.med.indexOf(Math.max(...R.med.filter(isFinite)));
    const rows = [];
    if (topYear) rows.push(["Most active year", String(topYear.y), `${fmtK(topYear.total)} · ${topYear.total >= R.yearMean ? "+" : ""}${Math.round((topYear.total / R.yearMean - 1) * 100)} % vs mean`]);
    if (lowYear && lowYear !== topYear) rows.push(["Quietest year", String(lowYear.y), `${fmtK(lowYear.total)} · ${Math.round((lowYear.total / R.yearMean - 1) * 100)} % vs mean`]);
    rows.push(["Most active calendar month", MONTHS_LONG[peak], `median ${fmtK(R.med[peak])}`]);
    rows.push(["Highest single month", `${MONTHS_LONG[D.cal[R.tMax]]} ${D.year[R.tMax]}`, fmtK(R.series[R.tMax])]);
    $("highlights").innerHTML = rows.map(([k, a, b]) => `<div><dt>${k}</dt><dd>${a}<span>${b}</span></dd></div>`).join("");
  }

  // ------------------------------------------------------------------ chrome
  function drawChrome() {
    const b = S.bbox;
    $("sel-name").textContent = b
      ? `${degLat(b.s)} to ${degLat(b.n)}, ${degLon(b.w)} to ${degLon(b.e)} · ${R.idx.length} cells`
      : `whole country · ${R.idx.length} cells`;
    const ex = D.extent;
    $("bb-n").value = (b ? b.n : ex.n).toFixed(2);
    $("bb-s").value = (b ? b.s : ex.s).toFixed(2);
    $("bb-w").value = (b ? b.w : ex.w).toFixed(2);
    $("bb-e").value = (b ? b.e : ex.e).toFixed(2);
    $("mode-harm").setAttribute("aria-pressed", String(S.mode === "harm"));
    $("mode-raw").setAttribute("aria-pressed", String(S.mode === "raw"));
    const v = D.meta.validation;
    $("mode-note").innerHTML = S.mode === "harm"
      ? "Every month is in VIIRS-equivalent hot spots. Months with a dot are modeled from MODIS; from February 2012 the counts are observed by VIIRS."
      : `<strong>Raw counts switch sensor in February 2012.</strong> MODIS before, VIIRS after. VIIRS reports about ${v.snpp_over_modis} times as many hot spots, so the upper rows look quieter than they were.`;
    $("fact-record").textContent = `${D.meta.months[0]} to ${D.meta.months[D.T - 1]}`;
  }

  function fillNotes() {
    const v = D.meta.validation;
    const m = v.methods;
    $("note-why").textContent = `MODIS sees fires at 1 km, VIIRS at 375 m. In the years both flew over Argentina, VIIRS reported ${v.snpp_over_modis} times as many hot spots as MODIS, and the factor changes with the season. A calendar that simply joins the two records shows a jump in 2012 that never happened on the ground.`;
    $("note-check").textContent = `Each year from 2012 to 2025 was hidden in turn, predicted from MODIS alone and compared with what VIIRS really saw. The model used here misses the monthly country total by ${fmt(m.M1.mae)} hot spots on average (typical month: ${fmt(v.mean_monthly_snpp)}); one fixed factor misses it by ${fmt(m.B0.mae)}. For the plain question "above or below the median" both agree with VIIRS in about ${Math.round(m.M1.median_agreement * 100)} % of months, so the model matters for the size of the numbers, not for that verdict.`;
  }

  // ------------------------------------------------------------------ downloads
  function save(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function areaTag() {
    const b = S.bbox;
    return b ? `${b.s}_${b.n}_${b.w}_${b.e}` : "country";
  }
  function dlMonthly() {
    const col = S.mode === "harm" ? "harmonized_viirs_eq" : "raw_sensor_count";
    const out = [`month,${col},source,median_same_calendar_month,ratio_to_median`];
    R.inRange.forEach((t) => {
      const md = R.med[D.cal[t]];
      out.push([D.meta.months[t], R.series[t].toFixed(1), sourceOf(t).replace(/,/g, ""), md.toFixed(1), md > 0 ? (R.series[t] / md).toFixed(3) : ""].join(","));
    });
    save(`wildfire_calendar_${D.meta.region.toLowerCase()}_${areaTag()}_${S.y0}-${S.y1}_monthly.csv`, out.join("\n") + "\n");
  }
  function dlCells() {
    const col = S.mode === "harm" ? "harmonized_viirs_eq" : "raw_sensor_count";
    const g = D.meta.grid;
    const out = [`month,cell_center_lat,cell_center_lon,${col},source`];
    R.inRange.forEach((t) => {
      const o = t * D.N;
      const src = sourceOf(t).replace(/,/g, "");
      for (let k = 0; k < R.idx.length; k++) {
        const i = R.idx[k];
        const v = R.vals[o + i];
        if (v < 0.0005) continue;
        out.push(`${D.meta.months[t]},${(D.lat[i] + g / 2).toFixed(3)},${(D.lon[i] + g / 2).toFixed(3)},${v.toFixed(3)},${src}`);
      }
    });
    save(`wildfire_calendar_${D.meta.region.toLowerCase()}_${areaTag()}_${S.y0}-${S.y1}_cells.csv`, out.join("\n") + "\n");
  }

  // ------------------------------------------------------------------ wiring
  function update() {
    compute();
    drawChrome();
    drawMap();
    drawCalendar();
    drawReading();
  }

  function bindControls() {
    const y0 = $("y0"), y1 = $("y1");
    const first = D.year[0], last = D.year[D.T - 1];
    for (let y = first; y <= last; y++) { y0.add(new Option(y, y)); y1.add(new Option(y, y)); }
    y0.value = first; y1.value = last;
    const onYear = (ev) => {
      let a = +y0.value, b = +y1.value;
      if (a > b) { if (ev.target === y0) b = a; else a = b; }
      y0.value = a; y1.value = b; S.y0 = a; S.y1 = b; update();
    };
    y0.addEventListener("change", onYear);
    y1.addEventListener("change", onYear);
    $("mode-harm").addEventListener("click", () => { S.mode = "harm"; update(); });
    $("mode-raw").addEventListener("click", () => { S.mode = "raw"; update(); });
    $("bbox-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const n = +$("bb-n").value, s = +$("bb-s").value, w = +$("bb-w").value, e = +$("bb-e").value;
      const ex = D.extent, msg = $("bbox-msg");
      if (![n, s, w, e].every(isFinite) || $("bb-n").value === "") { msg.textContent = "Enter four numbers in decimal degrees."; return; }
      if (n <= s || e <= w) { msg.textContent = "North must be greater than south, and east greater than west. Use negative numbers for south and west."; return; }
      if (s >= ex.n || n <= ex.s || w >= ex.e || e <= ex.w) { msg.textContent = `That area lies outside the data (${degLat(ex.s)} to ${degLat(ex.n)}, ${degLon(ex.w)} to ${degLon(ex.e)}).`; return; }
      msg.textContent = "";
      S.bbox = snapBox(w, s, e, n);
      update();
    });
    $("bbox-reset").addEventListener("click", () => { S.bbox = null; $("bbox-msg").textContent = ""; update(); });
    $("dl-month").addEventListener("click", dlMonthly);
    $("dl-cell").addEventListener("click", dlCells);
    let raf = 0;
    const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { sizeMap(); drawMap(); drawLegend($("map-legend")); drawLegend($("cal-legend")); drawCalendar(); }); };
    window.addEventListener("resize", redraw);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  async function start() {
    try {
      await load();
    } catch (err) {
      $("mode-note").textContent = "The data files could not be loaded. Serve the docs folder over HTTP (for example: python -m http.server) instead of opening the file directly.";
      return;
    }
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* fall back */ } }
    sizeMap();
    bindMap();
    bindCalendar();
    bindControls();
    fillNotes();
    update();
    drawLegend($("map-legend"));
  }
  start();
})();
