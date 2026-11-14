#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
firms_download.py - laedt aktive Feuer-Detektionen fuer Deutschland von NASA FIRMS (offizielle API).

Quelle:  https://firms.modaps.eosdis.nasa.gov/api/area/   (Rechteck um Deutschland)
Ablage:  data/raw/<SENSOR>/<PRODUKT>_<JJJJ-MM>.csv.gz     (unveraenderte NASA-Zeilen, je Monat, gzip)
Index:   data/raw/index.json

Aufruf:
  python firms_download.py                    alles Fehlende laden (gesamtes Archiv) bzw. aktualisieren
  python firms_download.py --start 2022-01-01 nur ab diesem Monat
  python firms_download.py --days 60          nur die letzten 60 Tage (ganze Monate)
  python firms_download.py --sources MODIS,VIIRS_SNPP
  python firms_download.py --dry-run          nur zeigen, was geladen wuerde

Es werden immer ganze Monate geladen. Pro Tag wird das beste Produkt gewaehlt: Standard Processing
(SP, wissenschaftliche Qualitaet, mit Einstufung der Quelle) wo vorhanden, sonst Near Real-Time (NRT).
Abgeschlossene Monate werden nie erneut geladen; der laufende Monat wird bei jedem Aufruf erneuert.
Der MAP_KEY steht in der Datei .env (FIRMS_MAP_KEY=...) oder in der Umgebungsvariable.
"""
import argparse
import calendar
import collections
import datetime as dt
import gzip
import http.client
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://firms.modaps.eosdis.nasa.gov"
ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw")
INDEX = os.path.join(RAW, "index.json")

# Rechteck um Deutschland: West, Sued, Ost, Nord (Grad). Der exakte Zuschnitt auf die
# Staatsgrenze passiert spaeter in der App.
AREA = "5.5,47,15.5,55.5"

# Sensor -> (SP-Produkt, NRT-Produkt, Transaktionsfaktor pro Tag und 60-Grad-Kachel, max. Tage pro Abfrage)
FAMILIES = collections.OrderedDict([
    ("VIIRS_NOAA21", ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT", 2.0, 5)),
    ("VIIRS_NOAA20", ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT", 2.0, 5)),
    ("VIIRS_SNPP", ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", 2.0, 5)),
    ("MODIS", ("MODIS_SP", "MODIS_NRT", 0.5, 5)),
    ("GOES", (None, "GOES_NRT", 5.0, 2)),          # geostationaer (ueber Deutschland: Meteosat)
])

TX_LIMIT = 5000          # Transaktionen pro 10 Minuten (FIRMS-Vorgabe)
TX_BUDGET = 4600         # so viel nutzen wir hoechstens
TX_WINDOW = 600.0
MAX_TRIES = 6

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


class Fatal(Exception):
    """Abbruch des gesamten Laufs (z. B. ungueltiger MAP_KEY)."""


class TaskError(Exception):
    """Ein einzelner Monat konnte nicht geladen werden."""


# ----------------------------------------------------------------------------- Hilfen

def read_key():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        env = os.path.join(ROOT, ".env")
        if os.path.exists(env):
            with open(env, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line.startswith("FIRMS_MAP_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", key or ""):
        raise Fatal("Kein gueltiger FIRMS_MAP_KEY gefunden (.env oder Umgebungsvariable).")
    return key


def http_get(url, timeout=300):
    """GET -> (status, body). Gibt auch bei HTTP-Fehlern den Antworttext zurueck."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "firms-download/1.0 (python-urllib)",
        "Accept-Encoding": "gzip",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                body = gzip.decompress(body)
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read() or b""
        if (e.headers.get("Content-Encoding") or "").lower() == "gzip":
            try:
                body = gzip.decompress(body)
            except OSError:
                pass
        return e.code, body


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def parse_date(s):
    return dt.datetime.strptime(s, "%Y-%m-%d").date()


def month_start(d):
    return d.replace(day=1)


def month_end(d):
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def next_month(d):
    return (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def raw_path(fam, product, month):
    return os.path.join(RAW, fam, "%s_%s.csv.gz" % (product, month.strftime("%Y-%m")))


def area_tiles(area):
    w, s, e, n = [float(x) for x in area.split(",")]
    return max(1, math.ceil((e - w) / 60.0)) * max(1, math.ceil((n - s) / 60.0))


def load_index():
    if os.path.exists(INDEX):
        with open(INDEX, encoding="utf-8") as fh:
            idx = json.load(fh)
    else:
        idx = {}
    idx.setdefault("files", {})
    return idx


def save_index(idx):
    os.makedirs(RAW, exist_ok=True)
    tmp = INDEX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(idx, fh, indent=0, sort_keys=True)
    os.replace(tmp, INDEX)


# ----------------------------------------------------------------------------- Ratenbegrenzung

class Limiter:
    """Haelt die Summe der Transaktionsgewichte im gleitenden 10-Minuten-Fenster unter dem Budget."""

    def __init__(self, budget=TX_BUDGET, window=TX_WINDOW):
        self.budget, self.window = budget, window
        self.events = collections.deque()      # (zeit, gewicht)
        self.lock = threading.Lock()
        self.total = 0
        self._last_note = 0.0

    def _used(self, now):
        while self.events and self.events[0][0] <= now - self.window:
            self.events.popleft()
        return sum(w for _, w in self.events)

    def acquire(self, weight):
        while True:
            with self.lock:
                now = time.monotonic()
                used = self._used(now)
                if used + weight <= self.budget:
                    self.events.append((now, weight))
                    self.total += weight
                    return
                need, acc, wait = used + weight - self.budget, 0, 5.0
                for ts, w in self.events:
                    acc += w
                    if acc >= need:
                        wait = ts + self.window - now + 0.5
                        break
                note = now - self._last_note > 120
                if note:
                    self._last_note = now
            if note:
                log("   ... Transaktionslimit (%d pro 10 min) erreicht, warte ca. %d s" % (TX_LIMIT, wait))
            time.sleep(max(1.0, min(wait, 15.0)))

    def sync(self, server_used):
        """Server zaehlt mehr als wir (z. B. andere Programme mit demselben Key) -> uebernehmen."""
        with self.lock:
            now = time.monotonic()
            used = self._used(now)
            if server_used > used:
                self.events.append((now, server_used - used))


def server_transactions(key):
    try:
        status, body = http_get("%s/mapserver/mapkey_status/?MAP_KEY=%s" % (API, key), timeout=60)
        if status == 200:
            return int(json.loads(body.decode("utf-8"))["current_transactions"])
    except Exception:
        pass
    return None


# ----------------------------------------------------------------------------- API

def get_availability(key):
    """-> {produkt: (min_datum, max_datum)}"""
    status, body = http_get("%s/api/data_availability/csv/%s/ALL" % (API, key), timeout=120)
    text = body.decode("utf-8", "replace")
    if status != 200 or not text.startswith("data_id"):
        if "MAP_KEY" in text:
            raise Fatal("FIRMS meldet: %s" % text.strip()[:200])
        raise Fatal("Datenverfuegbarkeit nicht abrufbar (HTTP %s): %s" % (status, text.strip()[:200]))
    out = {}
    for line in text.strip().splitlines()[1:]:
        parts = line.strip().split(",")
        if len(parts) >= 3:
            try:
                out[parts[0]] = (parse_date(parts[1]), parse_date(parts[2]))
            except ValueError:
                pass
    return out


def split_csv(body, d_from, d_to):
    """-> (kopfzeile, [zeilen], fehlertext|None). Erkennt abgeschnittene oder falsche Antworten."""
    text = body.decode("utf-8", "replace").replace("\r", "")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    header = lines[0].strip()
    cols = header.split(",")
    rows = lines[1:]
    if "acq_date" not in cols:
        return header, rows, "Spalte acq_date fehlt"
    i, n = cols.index("acq_date"), len(cols)
    lo, hi = d_from.isoformat(), d_to.isoformat()
    for r in rows:
        parts = r.split(",")
        if len(parts) != n:
            return header, rows, "abgeschnittene Antwort"
        if not (lo <= parts[i] <= hi):
            return header, rows, "Antwort enthaelt ein Datum ausserhalb der Abfrage"
    return header, rows, None


class Downloader:
    def __init__(self, key, idx, limiter, area):
        self.key, self.idx, self.limiter, self.area = key, idx, limiter, area
        self.tiles = area_tiles(area)
        self.lock = threading.Lock()
        self.done = 0
        self.rows = 0
        self.bytes = 0
        self.requests = 0
        self.abort = threading.Event()

    def weight(self, fam, days):
        return int(math.ceil(self.tiles * FAMILIES[fam][2] * days))

    def fetch(self, fam, product, d_from, days):
        """Eine Abfrage (bis zu 5 Tage). -> (kopfzeile, zeilen)"""
        d_to = d_from + dt.timedelta(days=days - 1)
        url = "%s/api/area/csv/%s/%s/%s/%d/%s" % (API, self.key, product, self.area, days, d_from.isoformat())
        weight = self.weight(fam, days)
        err = "?"
        for attempt in range(1, MAX_TRIES + 1):
            if self.abort.is_set():
                raise TaskError("abgebrochen")
            self.limiter.acquire(weight)
            try:
                status, body = http_get(url)
            except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
                err = "Netzwerkfehler (%s)" % type(e).__name__
                wait = min(90, 5 * 2 ** (attempt - 1))
            else:
                if status == 200 and body.startswith(b"latitude,longitude"):
                    header, rows, problem = split_csv(body, d_from, d_to)
                    if problem is None:
                        with self.lock:
                            self.requests += 1
                            n = self.requests
                        if n % 40 == 0:
                            used = server_transactions(self.key)
                            if used is not None:
                                self.limiter.sync(used)
                        return header, rows
                    err, wait = problem, 10
                else:
                    text = body[:300].decode("utf-8", "replace").strip()
                    if "MAP_KEY" in text and "nvalid" in text:
                        self.abort.set()
                        raise Fatal("FIRMS meldet: %s" % text)
                    busy = status in (403, 429, 503) or re.search(r"transaction|limit|exceed|too many", text, re.I)
                    if not busy and status == 400:
                        raise TaskError("FIRMS meldet: %s" % text[:120])
                    err = "HTTP %s %s" % (status, text[:80])
                    if busy:
                        used = server_transactions(self.key)
                        if used is not None:
                            self.limiter.sync(used)
                        wait = 60
                    else:
                        wait = min(90, 10 * attempt)
            if attempt < MAX_TRIES:
                log("   ! %s %s: %s - neuer Versuch in %d s (%d/%d)" % (
                    product, d_from.isoformat(), err, wait, attempt, MAX_TRIES))
                time.sleep(wait)
        raise TaskError(err)

    def run_task(self, task, total):
        fam, product, month, d_from, d_to = task
        t0 = time.time()
        step = FAMILIES[fam][3]
        header, rows, d = None, [], d_from
        while d <= d_to:
            days = min(step, (d_to - d).days + 1)
            h, r = self.fetch(fam, product, d, days)
            if header is None:
                header = h
            elif h != header:
                raise TaskError("Spalten aendern sich innerhalb des Monats")
            rows.extend(r)
            d += dt.timedelta(days=days)
        body = ("\n".join([header] + rows) + "\n").encode("utf-8")
        path = raw_path(fam, product, month)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        gz = gzip.compress(body, compresslevel=9, mtime=0)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(gz)
        os.replace(tmp, path)
        now = utcnow()
        day_end = dt.datetime.combine(d_to + dt.timedelta(days=1), dt.time(0), dt.timezone.utc)
        final = product.endswith("_SP") or now >= day_end + dt.timedelta(hours=12)
        mkey = month.strftime("%Y-%m")
        with self.lock:
            files = self.idx["files"]
            files["%s/%s" % (product, mkey)] = {
                "family": fam, "from": d_from.isoformat(), "to": d_to.isoformat(), "rows": len(rows),
                "bytes": len(body), "gz": len(gz),
                "downloaded": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "final": final,
            }
            # SP ersetzt vorlaeufige NRT-Daten desselben Monats, sobald es sie ganz abdeckt
            nrt = FAMILIES[fam][1]
            old = files.get("%s/%s" % (nrt, mkey))
            if product.endswith("_SP") and old and old["from"] >= d_from.isoformat() and old["to"] <= d_to.isoformat():
                del files["%s/%s" % (nrt, mkey)]
                try:
                    os.remove(raw_path(fam, nrt, month))
                except OSError:
                    pass
            self.done += 1
            self.rows += len(rows)
            self.bytes += len(body)
            n = self.done
            if n % 20 == 0:
                save_index(self.idx)
        log("[%4d/%d] %-13s %s  %-3s %7s Zeilen %6.1f KB  %4.1f s%s" % (
            n, total, fam, mkey, product.rsplit("_", 1)[-1], format(len(rows), ",").replace(",", "."),
            len(gz) / 1e3, time.time() - t0, "" if final else "  (laufender Monat)"))
        return len(rows)


# ----------------------------------------------------------------------------- Planung

def build_plan(args, avail, idx, now):
    today = now.date()
    fams = list(FAMILIES) if not args.sources else [s.strip().upper() for s in args.sources.split(",") if s.strip()]
    for f in fams:
        if f not in FAMILIES:
            raise Fatal("Unbekannter Sensor '%s'. Moeglich: %s" % (f, ", ".join(FAMILIES)))
    lo = hi = None
    if args.start or args.days:
        hi = parse_date(args.end) if args.end else today
        lo = parse_date(args.start) if args.start else hi - dt.timedelta(days=args.days - 1)
        if lo > hi:
            raise Fatal("Startdatum liegt nach dem Enddatum.")
        lo, hi = month_start(lo), month_end(hi)

    tasks, skipped = [], 0
    for fam in fams:
        sp, nrt, _, _ = FAMILIES[fam]
        ranges = [avail[p] for p in (sp, nrt) if p and p in avail]
        if not ranges:
            continue
        first = min(r[0] for r in ranges)
        last = min(today, max(r[1] for r in ranges))
        m = month_start(max(first, lo) if lo else first)
        stop = min(last, hi) if hi else last
        while m <= stop:
            m_end = month_end(m)
            sp_days = None
            if sp and sp in avail:
                a, b = max(m, avail[sp][0]), min(m_end, avail[sp][1], today)
                if a <= b:
                    sp_days = (a, b)
            nrt_days = None
            if nrt and nrt in avail:
                a, b = max(m, avail[nrt][0]), min(m_end, avail[nrt][1], today)
                if sp_days and a <= sp_days[1]:
                    a = max(a, sp_days[1] + dt.timedelta(days=1))    # SP hat Vorrang
                if a <= b:
                    nrt_days = (a, b)
            for product, rng in ((sp, sp_days), (nrt, nrt_days)):
                if not rng:
                    continue
                e = idx["files"].get("%s/%s" % (product, m.strftime("%Y-%m")))
                if (e and not args.force and e.get("final") and e.get("from") == rng[0].isoformat()
                        and e.get("to") == rng[1].isoformat() and os.path.exists(raw_path(fam, product, m))):
                    skipped += 1
                    continue
                tasks.append((fam, product, m, rng[0], rng[1]))
            m = next_month(m)
    order = {f: i for i, f in enumerate(FAMILIES)}
    # neueste Monate zuerst; die duenn besetzten geostationaeren Daten ganz am Schluss
    tasks.sort(key=lambda t: (t[0] == "GOES", -t[2].toordinal(), order[t[0]]))
    return tasks, skipped


def main():
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="NASA-FIRMS-Feuerdaten fuer Deutschland herunterladen.")
    ap.add_argument("--days", type=int, help="nur die letzten N Tage (ganze Monate)")
    ap.add_argument("--start", help="ab Datum JJJJ-MM-TT (ganzer Monat)")
    ap.add_argument("--end", help="bis Datum JJJJ-MM-TT (ganzer Monat, Standard: heute)")
    ap.add_argument("--sources", help="Sensoren, kommagetrennt (Standard: alle): " + ",".join(FAMILIES))
    ap.add_argument("--area", help="anderes Rechteck West,Sued,Ost,Nord (nur bei leerem Datenordner)")
    ap.add_argument("--workers", type=int, default=6, help="parallel geladene Monate (Standard 6)")
    ap.add_argument("--force", action="store_true", help="auch vorhandene Monate neu laden")
    ap.add_argument("--dry-run", action="store_true", help="nur anzeigen, was geladen wuerde")
    args = ap.parse_args()

    try:
        key = read_key()
        idx = load_index()
        area = args.area or idx.get("area") or AREA
        if idx["files"] and idx.get("area") and idx["area"] != area:
            raise Fatal("Im Datenordner liegen Daten fuer das Rechteck %s. Fuer ein anderes Gebiet bitte "
                        "data/raw und web/data vorher loeschen." % idx["area"])
        if not re.fullmatch(r"-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}", area):
            raise Fatal("Rechteck bitte als West,Sued,Ost,Nord in Grad angeben.")
        idx["area"] = area
        now = utcnow()
        avail = get_availability(key)
        idx["availability"] = {k: [a.isoformat(), b.isoformat()] for k, (a, b) in sorted(avail.items())}
        idx["availability_checked"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        tasks, skipped = build_plan(args, avail, idx, now)
    except Fatal as e:
        log("FEHLER: %s" % e)
        return 2

    limiter = Limiter()
    dl = Downloader(key, idx, limiter, area)
    tx = requests = 0
    for fam, product, m, a, b in tasks:
        days, step = (b - a).days + 1, FAMILIES[fam][3]
        requests += math.ceil(days / step)
        tx += sum(dl.weight(fam, min(step, days - i)) for i in range(0, days, step))
    log("FIRMS-Download (Rechteck %s): %d Monatsdateien zu laden, %d bereits vollstaendig." % (
        area, len(tasks), skipped))
    if tasks:
        log("  %s bis %s | %d Abfragen, ca. %d Transaktionen (Limit %d pro 10 min -> mind. %d min)" % (
            min(t[3] for t in tasks), max(t[4] for t in tasks), requests, tx, TX_LIMIT,
            max(0, (tx - 1) // TX_BUDGET) * 10))
    if args.dry_run or not tasks:
        if not args.dry_run:
            save_index(idx)
            log("Alles aktuell.")
        return 0

    used = server_transactions(key)
    if used:
        limiter.sync(used + 5)
    failed = []
    t0 = time.time()
    try:
        with ThreadPoolExecutor(max_workers=max(1, min(8, args.workers))) as pool:
            futs = {pool.submit(dl.run_task, t, len(tasks)): t for t in tasks}
            try:
                for fut in as_completed(futs):
                    t = futs[fut]
                    try:
                        fut.result()
                    except TaskError as e:
                        failed.append((t, str(e)))
                        log("   x %s %s fehlgeschlagen: %s" % (t[1], t[2].strftime("%Y-%m"), e))
                    except Fatal as e:
                        log("FEHLER: %s" % e)
                        dl.abort.set()
                        for f in futs:
                            f.cancel()
                        return 2
            except KeyboardInterrupt:
                log("Abbruch - bereits geladene Monate bleiben erhalten.")
                dl.abort.set()
                for f in futs:
                    f.cancel()
                return 130
    finally:
        save_index(idx)

    log("Fertig: %d Monatsdateien, %s Detektionen, %.1f MB CSV in %.1f min. %d fehlgeschlagen." % (
        dl.done, format(dl.rows, ",").replace(",", "."), dl.bytes / 1e6, (time.time() - t0) / 60, len(failed)))
    for t, e in failed:
        log("   fehlend: %s %s (%s)" % (t[1], t[2].strftime("%Y-%m"), e))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
