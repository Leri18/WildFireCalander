#!/usr/bin/env python3
"""Download the keyless FIRMS yearly country archive (science quality) for one region.

Usage:
    python scripts/fetch_firms.py --region Argentina

The FIRMS server is flaky (connection resets, HTTP 502, tunnels closed after a few
seconds), so this script
  * downloads strictly sequentially,
  * retries every file (default 8 attempts, 8-15 s backoff),
  * resumes partial files with HTTP Range requests,
  * verifies every file size against the official index,
  * skips files that are already complete (safe to re-run).

Raw files go to data/raw/firms/ which is gitignored and must never be committed.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

import requests

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
INDEX_URL = f"{BASE}/yearly_summary_files.txt"
INSTRUMENTS = ("modis", "viirs-snpp", "viirs-jpss1")
UA = {"User-Agent": "firms-archive-fetch/1.0 (python-requests)"}


def backoff(lo: float, hi: float) -> None:
    time.sleep(random.uniform(lo, hi))


def fetch_index(dest: Path, retries: int, lo: float, hi: float) -> dict[str, int]:
    """Return {filename: size_in_bytes} from the official index file."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(INDEX_URL, headers=UA, timeout=(20, 120))
            r.raise_for_status()
            text = r.text
            sizes: dict[str, int] = {}
            for line in text.splitlines():
                parts = line.strip().split(",")
                if len(parts) >= 2 and parts[1].strip().isdigit():
                    sizes[parts[0].strip()] = int(parts[1])
            if len(sizes) < 100:
                raise RuntimeError(f"index looks truncated ({len(sizes)} entries)")
            dest.write_text(text)
            return sizes
        except Exception as exc:  # noqa: BLE001 - network errors of any kind are retried
            last = exc
            print(f"  index attempt {attempt}/{retries} failed: {exc}", flush=True)
            backoff(lo, hi)
    raise SystemExit(f"could not fetch index: {last}")


def download(url: str, dest: Path, expected: int, retries: int, lo: float, hi: float) -> bool:
    """Download url to dest with resume. True if dest has exactly `expected` bytes."""
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        have = part.stat().st_size if part.exists() else 0
        if have > expected:  # corrupt partial file, start over
            part.unlink()
            have = 0
        if have == expected:
            part.replace(dest)
            return True
        headers = dict(UA)
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with requests.get(url, headers=headers, stream=True, timeout=(20, 60)) as r:
                if r.status_code == 200 and have:
                    # server ignored the Range header: restart from zero
                    part.unlink()
                    have = 0
                elif r.status_code not in (200, 206):
                    raise RuntimeError(f"HTTP {r.status_code}")
                with open(part, "ab") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        fh.write(chunk)
        except Exception as exc:  # noqa: BLE001
            got = part.stat().st_size if part.exists() else 0
            print(f"    attempt {attempt}/{retries}: {type(exc).__name__}: {str(exc)[:90]} "
                  f"({got}/{expected} bytes)", flush=True)
        got = part.stat().st_size if part.exists() else 0
        if got == expected:
            part.replace(dest)
            return True
        if got > have:
            # progress was made: resume quickly, the tunnel just closed
            time.sleep(2)
        else:
            backoff(lo, hi)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True, help="country name exactly as in the FIRMS file names")
    ap.add_argument("--out", default="data/raw/firms", help="output directory (gitignored)")
    ap.add_argument("--retries", type=int, default=8, help="attempts without progress per file (>= 6)")
    ap.add_argument("--backoff", type=float, nargs=2, default=(8.0, 15.0), metavar=("LO", "HI"))
    ap.add_argument("--max-year", type=int, default=2025)
    args = ap.parse_args()
    retries = max(6, args.retries)
    lo, hi = args.backoff

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print("fetching index ...", flush=True)
    sizes = fetch_index(out / "yearly_summary_files.txt", retries, lo, hi)

    wanted = []
    for name, size in sizes.items():
        stem = name[:-4] if name.endswith(".csv") else name
        for inst in INSTRUMENTS:
            prefix = f"{inst}_"
            if stem.startswith(prefix):
                year, _, region = stem[len(prefix):].partition("_")
                if region == args.region and year.isdigit() and int(year) <= args.max_year:
                    wanted.append((inst, int(year), name, size))
    wanted.sort()
    if not wanted:
        raise SystemExit(f"no files for region {args.region!r} in the index")
    total = sum(w[3] for w in wanted)
    print(f"{len(wanted)} files, {total / 1e6:.1f} MB for {args.region}", flush=True)

    failed = []
    for i, (inst, year, name, size) in enumerate(wanted, 1):
        dest = out / name
        if dest.exists() and dest.stat().st_size == size:
            print(f"[{i}/{len(wanted)}] {name}: complete, skipped", flush=True)
            continue
        if dest.exists():
            dest.unlink()  # wrong size: re-download
        url = f"{BASE}/{inst}/{year}/{name}"
        print(f"[{i}/{len(wanted)}] {name} ({size / 1e6:.1f} MB)", flush=True)
        t0 = time.time()
        if download(url, dest, size, retries, lo, hi):
            print(f"    ok in {time.time() - t0:.0f} s", flush=True)
        else:
            failed.append(name)
            print("    FAILED", flush=True)
        time.sleep(1)

    ok = len(wanted) - len(failed)
    print(f"done: {ok}/{len(wanted)} files complete and size-verified", flush=True)
    if failed:
        print("failed: " + ", ".join(failed), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
