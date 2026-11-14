#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_data.py - wandelt die heruntergeladenen FIRMS-CSV in kompakte Binaerdateien fuer die Browser-App um.

Eingabe:  data/raw/<SENSOR>/<PRODUKT>_<JJJJ-MM>.csv.gz  +  data/raw/index.json
Ausgabe:  web/data/<SENSOR>.bin  (alle Jahre, nach Zeit sortiert)  +  web/data/manifest.json

Binaerformat (little-endian):
  Kopf, 16 Byte:  "FRMS", u32 Version, u32 Anzahl, u32 Satzlaenge (28)
  je Detektion, 28 Byte:
     0  f32  Laenge (Grad)                 12  u16  Tag seit 2000-01-01 (UTC)
     4  f32  Breite (Grad)                 14  u16  Minute des Tages (UTC)
     8  f32  FRP in MW (-1 = fehlt)        16  u16  aux1: Helligkeit Kanal 1 in 0,1 K (0 = fehlt)
                                           18  u16  aux2: Helligkeit Kanal 2 in 0,1 K (0 = fehlt)
    20  u8   Konfidenz in % (255 = nur Klasse bekannt)
    21  u8   Flags: Bit0 Nacht | Bit1-2 Konfidenzklasse (0 niedrig, 1 nominal, 2 hoch, 3 unbekannt)
                    | Bit3-5 Art der Quelle (siehe TYPES) | Bit6 Tag/Nacht unbekannt | Bit7 NRT-Daten
    22  u8   scan  in 0,02 km              24  u8   Index in die Satellitenliste (manifest)
    23  u8   track in 0,02 km              25  u8   Index in die Versionsliste (manifest)
    26  u8   Region (255 = offen; die App traegt hier das Bundesland ein)   27  u8  frei

Art der Quelle (Bit3-5):  0 unbekannt (NRT) | 1 vermuteter Vegetationsbrand | 2 aktiver Vulkan
  | 3 andere statische Landquelle (z. B. Industrie) | 4 Offshore   <- Einstufung der NASA, nur SP
  | 5 statische Quelle, ABGELEITET: NRT-Detektion an einem Ort, den die NASA in den SP-Daten
      als statische Quelle fuehrt (Umkreis ca. 1 km, geostationaer ca. 3 km)
"""
import csv
import datetime as dt
import gzip
import json
import os
import re
import struct
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "web", "data")
MANIFEST = os.path.join(OUT, "manifest.json")
FORMAT = 2
EPOCH = dt.date(2000, 1, 1)
HEADER = struct.Struct("<4sIII")
REC = struct.Struct("<fffHHHHBBBBBBBB")
ORDER = ["VIIRS_NOAA21", "VIIRS_NOAA20", "VIIRS_SNPP", "MODIS", "GOES"]

LETTER = {"l": 0, "n": 1, "m": 1, "h": 2}
# GOES-ABI-Feuermaske: 10 processed, 11 saturated, 12 cloud contaminated, 13 high, 14 medium, 15 low
# probability; 30..35 dieselben Klassen zeitlich gefiltert.
CODE_CLASS = {10: 2, 11: 2, 12: 1, 13: 1, 14: 0, 15: 0}


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def detect_kind(fam, sat, values):
    """Wie ist die Spalte 'confidence' bei diesem Satelliten zu lesen?"""
    vals = [v.strip() for v in values if v and v.strip()]
    if not vals:
        return "none"
    if all(v.lower() in LETTER for v in vals[:200]):
        return "class"
    nums = [x for x in (num(v) for v in vals) if x is not None]
    if not nums:
        return "none"
    if fam == "GOES":
        if re.fullmatch(r"G\d+", sat) and all(x == int(x) and (10 <= x <= 15 or 30 <= x <= 35) for x in nums):
            return "code"
        if max(nums) <= 1.0:
            return "fraction"
    return "percent"


def conf_of(kind, s):
    """-> (Prozent 0..100 | 255, Klasse 0..3)"""
    if kind == "class":
        c = LETTER.get(s.strip().lower())
        return 255, (3 if c is None else c)
    v = num(s)
    if v is None or kind == "none":
        return 255, 3
    if kind == "code":
        code = int(round(v))
        return 255, CODE_CLASS.get(code - 20 if code >= 30 else code, 3)
    if kind == "fraction":
        v *= 100.0
    p = int(round(max(0.0, min(100.0, v))))
    return p, (0 if p < 30 else (1 if p < 80 else 2))


def geo_footprint(sat):
    """Nominale Pixelgroesse geostationaerer Sensoren in 0,02-km-Einheiten."""
    m = re.match(r"met(\d+)", sat.lower())
    if m and int(m.group(1)) < 12:
        return 150          # Meteosat Second Generation (SEVIRI): 3 km
    return 100              # Meteosat Third Generation, GOES ABI, Himawari AHI: 2 km


def read_csv(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") as fh:
        rd = csv.reader(fh)
        header = [h.strip() for h in (next(rd, None) or [])]
        rows = [r for r in rd if len(r) == len(header)]
    return header, rows


def cell(lat, lon):
    return int(round(lat * 100.0)), int(round(lon * 100.0))


def main():
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    index_file = os.path.join(RAW, "index.json")
    if not os.path.exists(index_file):
        print("Keine Rohdaten gefunden - zuerst firms_download.py ausfuehren.")
        return 2
    with open(index_file, encoding="utf-8") as fh:
        index = json.load(fh)
    t0 = time.time()

    # Dateien je Sensor, zeitlich sortiert (im selben Monat SP vor NRT)
    by_fam = {}
    for key, e in index.get("files", {}).items():
        product, month = key.split("/")
        fam = e.get("family")
        path = os.path.join(RAW, fam, "%s_%s.csv.gz" % (product, month))
        if os.path.exists(path):
            by_fam.setdefault(fam, []).append((month, 0 if product.endswith("_SP") else 1, product, path, e))
    for lst in by_fam.values():
        lst.sort(key=lambda x: (x[0], x[1]))

    # 1. Durchgang: Orte, die die NASA in den SP-Daten als statische Quelle (type 2) fuehrt
    static = set()
    for fam, lst in by_fam.items():
        for month, is_nrt, product, path, e in lst:
            if is_nrt:
                continue
            header, rows = read_csv(path)
            if "type" not in header:
                continue
            i_t, i_la, i_lo = header.index("type"), header.index("latitude"), header.index("longitude")
            for r in rows:
                if r[i_t].strip() == "2":
                    la, lo = num(r[i_la]), num(r[i_lo])
                    if la is not None and lo is not None:
                        static.add(cell(la, lo))

    os.makedirs(OUT, exist_ok=True)
    sources, total = {}, 0
    for fam in ORDER + sorted(set(by_fam) - set(ORDER)):
        lst = by_fam.get(fam)
        if not lst:
            continue
        geo = fam == "GOES"
        reach = 3 if geo else 1
        sp_ranges = [(e["from"], e["to"]) for _, is_nrt, _, _, e in lst if not is_nrt]
        sats, vers, kinds_seen = {}, {}, {}
        out = bytearray(HEADER.size)
        n = n_nrt = bad = 0
        first_day = last_day = nrt_from = None
        types = [0] * 8
        for month, is_nrt, product, path, e in lst:
            header, rows = read_csv(path)
            col = {name: i for i, name in enumerate(header)}

            def idx(*names):
                for nm in names:
                    if nm in col:
                        return col[nm]
                return None

            i_lat, i_lon, i_date, i_time = idx("latitude"), idx("longitude"), idx("acq_date"), idx("acq_time")
            if None in (i_lat, i_lon, i_date, i_time):
                print("  UEBERSPRUNGEN (unerwartete Spalten): %s" % os.path.basename(path))
                continue
            i_frp, i_conf, i_dn = idx("frp"), idx("confidence"), idx("daynight")
            i_sat, i_ver, i_type = idx("satellite"), idx("version"), idx("type")
            i_scan, i_track = idx("scan"), idx("track")
            i_a1, i_a2 = idx("bright_ti4", "brightness"), idx("bright_ti5", "bright_t31")

            # Lesart der Konfidenz je Satellit und Version in dieser Datei
            groups = {}
            if i_conf is not None:
                for r in rows:
                    g = (r[i_sat].strip() if i_sat is not None else "", r[i_ver].strip() if i_ver is not None else "")
                    groups.setdefault(g, []).append(r[i_conf])
            kinds = {g: detect_kind(fam, g[0], v) for g, v in groups.items()}

            recs = []
            for r in rows:
                d = r[i_date].strip()
                if not (e["from"] <= d <= e["to"]):
                    bad += 1
                    continue
                if is_nrt and any(a <= d <= b for a, b in sp_ranges):
                    continue                      # fuer diesen Tag gibt es bereits SP-Daten
                lat, lon, t = num(r[i_lat]), num(r[i_lon]), num(r[i_time])
                if lat is None or lon is None or t is None or not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                    bad += 1
                    continue
                try:
                    day = (dt.date(int(d[0:4]), int(d[5:7]), int(d[8:10])) - EPOCH).days
                except ValueError:
                    bad += 1
                    continue
                if not (0 <= day <= 65535):
                    bad += 1
                    continue
                hh, mm = divmod(int(t), 100)
                minute = max(0, min(1439, hh * 60 + mm))
                frp = num(r[i_frp]) if i_frp is not None else None
                if frp is None or frp < 0:
                    frp = -1.0
                sat = r[i_sat].strip() if i_sat is not None else ""
                ver = r[i_ver].strip() if i_ver is not None else ""
                b1 = num(r[i_a1]) if i_a1 is not None else None
                b2 = num(r[i_a2]) if i_a2 is not None else None
                a1 = min(65535, int(round(b1 * 10))) if b1 and b1 > 0 else 0
                a2 = min(65535, int(round(b2 * 10))) if b2 and b2 > 0 else 0
                if geo:
                    sc = tr = geo_footprint(sat)
                else:
                    s1 = num(r[i_scan]) if i_scan is not None else None
                    s2 = num(r[i_track]) if i_track is not None else None
                    sc = max(1, min(255, int(round(s1 / 0.02)))) if s1 and s1 > 0 else 0
                    tr = max(1, min(255, int(round(s2 / 0.02)))) if s2 and s2 > 0 else 0
                kind = kinds.get((sat, ver), "none")
                craw, ccls = conf_of(kind, r[i_conf]) if i_conf is not None else (255, 3)
                kinds_seen[sat] = kind
                flags = ccls << 1
                if geo or i_dn is None:
                    flags |= 64
                elif r[i_dn].strip().upper() == "N":
                    flags |= 1
                tcode = 0
                if i_type is not None:
                    ty = num(r[i_type])
                    if ty is not None and 0 <= ty <= 3:
                        tcode = int(ty) + 1
                if tcode == 0 and static:
                    ci, cj = cell(lat, lon)
                    if any((ci + a, cj + b) in static for a in range(-reach, reach + 1) for b in range(-reach, reach + 1)):
                        tcode = 5
                flags |= tcode << 3
                if is_nrt:
                    flags |= 128
                    n_nrt += 1
                    if nrt_from is None or d < nrt_from:
                        nrt_from = d
                if sat not in sats:
                    sats[sat] = min(254, len(sats))
                if ver not in vers:
                    vers[ver] = min(254, len(vers))
                types[tcode] += 1
                recs.append((day, minute, lon, lat, frp, a1, a2, craw, flags, sc, tr, sats[sat], vers[ver]))
            recs.sort()
            if recs:
                if first_day is None or recs[0][0] < first_day:
                    first_day = recs[0][0]
                if last_day is None or recs[-1][0] > last_day:
                    last_day = recs[-1][0]
            for (day, minute, lon, lat, frp, a1, a2, craw, flags, sc, tr, si, vi) in recs:
                out += REC.pack(lon, lat, frp, day, minute, a1, a2, craw, flags, sc, tr, si, vi, 255, 0)
            n += len(recs)
        HEADER.pack_into(out, 0, b"FRMS", FORMAT, n, REC.size)
        dst = os.path.join(OUT, fam + ".bin")
        tmp = dst + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(out)
        os.replace(tmp, dst)
        iso = lambda day: (EPOCH + dt.timedelta(days=day)).isoformat() if day is not None else None
        sources[fam] = {
            "file": fam + ".bin", "n": n, "bytes": len(out), "from": iso(first_day), "to": iso(last_day),
            "nrt": n_nrt, "nrtFrom": nrt_from, "types": types,
            "sat": [s for s, _ in sorted(sats.items(), key=lambda kv: kv[1])],
            "ver": [v for v, _ in sorted(vers.items(), key=lambda kv: kv[1])],
            "ck": [kinds_seen.get(s, "none") for s, _ in sorted(sats.items(), key=lambda kv: kv[1])],
        }
        if bad:
            sources[fam]["bad"] = bad
        total += n
        print("  %-13s %9s Detektionen  %s bis %s  (%.1f MB)" % (
            fam, format(n, ",").replace(",", "."), iso(first_day), iso(last_day), len(out) / 1e6), flush=True)

    files = index.get("files", {})
    # Wie viele Monate fehlen noch bis zum vollstaendigen Archiv? (laufender oder abgebrochener Download)
    avail = index.get("availability", {})
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    missing = 0
    for fam in ORDER:
        rng = [avail[p] for p in (fam + "_SP", fam + "_NRT") if p in avail]
        if not rng:
            continue
        first, last = min(r[0] for r in rng), min(today, max(r[1] for r in rng))
        have = {k.split("/")[1] for k, e in files.items() if e.get("family") == fam}
        y, m = int(first[:4]), int(first[5:7])
        while "%04d-%02d" % (y, m) <= last[:7]:
            if "%04d-%02d" % (y, m) not in have:
                missing += 1
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    manifest = {
        "format": FORMAT,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "epoch": EPOCH.isoformat(), "header": HEADER.size, "record": REC.size,
        "area": index.get("area"),
        "availability": index.get("availability", {}),
        "availability_checked": index.get("availability_checked"),
        "downloaded": max([e.get("downloaded", "") for e in files.values()] or [""]),
        "months": len(files), "missingMonths": missing, "staticCells": len(static),
        "sources": sources,
    }
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, separators=(",", ":"))
    os.replace(tmp, MANIFEST)
    print("Fertig: %s Detektionen aus %d Monatsdateien in %.1f s." % (
        format(total, ",").replace(",", "."), len(files), time.time() - t0), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
