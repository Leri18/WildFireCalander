#!/usr/bin/env python3
"""Build one unified, sensor-independent hotspot table from the raw FIRMS country CSVs.

Usage:
    python scripts/build_dataset.py --region Argentina

Input : data/raw/firms/{modis,viirs-snpp,viirs-jpss1}_{year}_{region}.csv
Output: data/processed/{region}/sensor={MODIS|VIIRS}/year={YYYY}/{satellite}.parquet (zstd)
        data/processed/{region}/build_summary.json  (all row counts and checks)

Unified schema (identical for every sensor):
    latitude, longitude       float64, degrees
    acq_datetime_utc          timestamp, acq_date + acq_time (zero-padded HHMM, UTC)
    sensor                    MODIS | VIIRS            (hive partition key in the path)
    satellite                 Terra | Aqua | S-NPP | NOAA-20
    confidence_raw            original value as string (MODIS 0-100, VIIRS l/n/h)
    confidence_class          low | nominal | high
    frp                       fire radiative power, MW
    daynight                  D | N
    version                   collection / processing version as delivered
    type                      0 vegetation fire, 1 volcano, 2 static land source, 3 offshore
    bt_mir                    MODIS `brightness` (ch. 21/22) / VIIRS `bright_ti4`, Kelvin
    bt_tir                    MODIS `bright_t31` / VIIRS `bright_ti5`, Kelvin
    scan, track               along-scan / along-track pixel size (km)

MODIS confidence classes follow Table 11 (section 8.4.3, page 51) of the
"MODIS Collection 6 and Collection 6.1 Active Fire Product User's Guide", v1.0:
    0 % <= C < 30 %  low   |  30 % <= C < 80 %  nominal  |  80 % <= C <= 100 %  high
https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf

VIIRS low-confidence night-time detections are South Atlantic Anomaly artefacts; they
are counted, reported and excluded from the processed data.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SATELLITE = {"Terra": "Terra", "Aqua": "Aqua", "N": "S-NPP", "N20": "NOAA-20",
             "T": "Terra", "A": "Aqua", "1": "NOAA-20"}
VIIRS_CONF = {"l": "low", "n": "nominal", "h": "high",
              "low": "low", "nominal": "nominal", "high": "high"}
FILE_RE = re.compile(r"^(modis|viirs-snpp|viirs-jpss1)_(\d{4})_(.+)\.csv$")
COLUMNS = ["latitude", "longitude", "acq_datetime_utc", "satellite", "confidence_raw",
           "confidence_class", "frp", "daynight", "version", "type", "bt_mir", "bt_tir",
           "scan", "track"]


def count_csv_rows(path: Path) -> int:
    """Data rows of a CSV counted independently of pandas (newlines minus header)."""
    n = 0
    last = b"\n"
    with open(path, "rb") as fh:
        while True:
            buf = fh.read(1 << 20)
            if not buf:
                break
            n += buf.count(b"\n")
            last = buf[-1:]
    if last != b"\n":
        n += 1
    return n - 1


def modis_confidence_class(conf: pd.Series) -> pd.Series:
    c = pd.to_numeric(conf, errors="raise")
    if not c.between(0, 100).all():
        raise ValueError("MODIS confidence outside 0-100")
    out = np.where(c < 30, "low", np.where(c < 80, "nominal", "high"))
    return pd.Series(out, index=conf.index)


def unify(raw: pd.DataFrame, inst: str) -> pd.DataFrame:
    df = pd.DataFrame()
    df["latitude"] = raw["latitude"].astype("float64")
    df["longitude"] = raw["longitude"].astype("float64")
    hhmm = raw["acq_time"].astype(str).str.strip().str.zfill(4)
    if not hhmm.str.fullmatch(r"([01]\d|2[0-3])[0-5]\d").all():
        raise ValueError("unexpected acq_time value")
    df["acq_datetime_utc"] = pd.to_datetime(
        raw["acq_date"].astype(str) + " " + hhmm, format="%Y-%m-%d %H%M").astype("datetime64[s]")
    sat = raw["satellite"].astype(str).str.strip().map(SATELLITE)
    if sat.isna().any():
        raise ValueError(f"unknown satellite code(s): {raw['satellite'][sat.isna()].unique()}")
    df["satellite"] = sat
    conf = raw["confidence"].astype(str).str.strip()
    df["confidence_raw"] = conf
    if inst == "modis":
        df["confidence_class"] = modis_confidence_class(conf)
        df["bt_mir"] = raw["brightness"].astype("float32")
        df["bt_tir"] = raw["bright_t31"].astype("float32")
    else:
        cls = conf.str.lower().map(VIIRS_CONF)
        if cls.isna().any():
            raise ValueError(f"unknown VIIRS confidence: {conf[cls.isna()].unique()}")
        df["confidence_class"] = cls
        df["bt_mir"] = raw["bright_ti4"].astype("float32")
        df["bt_tir"] = raw["bright_ti5"].astype("float32")
    df["frp"] = raw["frp"].astype("float32")
    df["daynight"] = raw["daynight"].astype(str).str.strip()
    if not df["daynight"].isin(["D", "N"]).all():
        raise ValueError("unexpected daynight value")
    df["version"] = raw["version"].astype(str).str.strip()
    df["type"] = raw["type"].astype("int8")
    df["scan"] = raw["scan"].astype("float32")
    df["track"] = raw["track"].astype("float32")
    for col in ("satellite", "confidence_class", "daynight", "version"):
        df[col] = df[col].astype("category")
    return df[COLUMNS]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True)
    ap.add_argument("--raw", default="data/raw/firms")
    ap.add_argument("--out", default="data/processed")
    args = ap.parse_args()

    raw_dir = Path(args.raw)
    out_dir = Path(args.out) / args.region.lower()
    files = []
    for p in sorted(raw_dir.glob(f"*_{args.region}.csv")):
        m = FILE_RE.match(p.name)
        if m and m.group(3) == args.region:
            files.append((m.group(1), int(m.group(2)), p))
    if not files:
        raise SystemExit(f"no raw files for {args.region} in {raw_dir}")
    if out_dir.exists():
        shutil.rmtree(out_dir)

    records = []
    total_bytes = 0
    for inst, year, path in files:
        n_raw = count_csv_rows(path)
        raw = pd.read_csv(path, dtype={"acq_time": str, "confidence": str, "version": str,
                                       "satellite": str, "acq_date": str})
        df = unify(raw, inst)
        if len(df) != n_raw:
            raise SystemExit(f"ROW MISMATCH {path.name}: csv={n_raw} parsed={len(df)}")
        if not (df["acq_datetime_utc"].dt.year == year).all():
            raise SystemExit(f"{path.name}: acquisition dates outside {year}")
        sensor = "MODIS" if inst == "modis" else "VIIRS"
        saa = (df["confidence_class"] == "low") & (df["daynight"] == "N") if sensor == "VIIRS" \
            else pd.Series(False, index=df.index)
        n_saa = int(saa.sum())
        kept = df[~saa]
        for sat, part in kept.groupby("satellite", observed=True):
            target = out_dir / f"sensor={sensor}" / f"year={year}"
            target.mkdir(parents=True, exist_ok=True)
            fp = target / f"{sat}.parquet"
            part.sort_values("acq_datetime_utc").to_parquet(fp, compression="zstd", index=False)
            n_back = len(pd.read_parquet(fp, columns=["type"]))
            if n_back != len(part):
                raise SystemExit(f"parquet row mismatch {fp}")
            total_bytes += fp.stat().st_size
            rec = {"file": path.name, "sensor": sensor, "satellite": str(sat), "year": year,
                   "rows_raw_csv": n_raw, "rows_written": int(len(part)),
                   "rows_excluded_viirs_low_night": n_saa,
                   "night_rows": int((part["daynight"] == "N").sum())}
            for t in range(4):
                rec[f"type{t}"] = int((part["type"] == t).sum())
            for c in ("low", "nominal", "high"):
                rec[f"conf_{c}"] = int((part["confidence_class"] == c).sum())
            rec["versions"] = sorted(part["version"].astype(str).unique().tolist())
            records.append(rec)
        written = sum(r["rows_written"] for r in records if r["file"] == path.name)
        if written + n_saa != n_raw:
            raise SystemExit(f"ROW MISMATCH after write {path.name}")
        print(f"{path.name}: {n_raw} rows ok (excluded VIIRS low/night: {n_saa})", flush=True)

    tab = pd.DataFrame(records)
    print("\n=== rows per sensor / satellite / year (after exclusions) ===")
    pivot = tab.pivot_table(index="year", columns="satellite", values="rows_written",
                            aggfunc="sum", fill_value=0)
    print(pivot.to_string())
    print("\n=== totals and type shares per satellite ===")
    agg = tab.groupby("satellite")[["rows_written", "type0", "type1", "type2", "type3",
                                    "night_rows", "conf_low", "conf_nominal", "conf_high"]].sum()
    for t in range(4):
        agg[f"type{t}_pct"] = (100 * agg[f"type{t}"] / agg["rows_written"]).round(3)
    agg["night_pct"] = (100 * agg["night_rows"] / agg["rows_written"]).round(2)
    print(agg.to_string())
    files_tab = tab.groupby("file", as_index=False).agg(
        rows_raw_csv=("rows_raw_csv", "first"),
        rows_excluded=("rows_excluded_viirs_low_night", "first"))
    n_raw_total = int(files_tab["rows_raw_csv"].sum())
    n_saa_total = int(files_tab["rows_excluded"].sum())
    print(f"\nfiles: {len(files)}  raw rows: {n_raw_total}  written: {int(tab['rows_written'].sum())}")
    print(f"VIIRS low-confidence NIGHT detections found and excluded: {n_saa_total}")
    print(f"parquet size: {total_bytes / 1e6:.1f} MB")

    summary = {
        "region": args.region, "n_files": len(files), "rows_raw_total": n_raw_total,
        "rows_written_total": int(tab["rows_written"].sum()),
        "viirs_low_night_excluded_total": n_saa_total,
        "viirs_low_night_excluded_by_file": {
            r["file"]: int(r["rows_excluded"]) for _, r in files_tab.iterrows() if r["rows_excluded"]},
        "raw_bytes_total": int(sum(p.stat().st_size for _, _, p in files)),
        "parquet_bytes_total": int(total_bytes),
        "per_satellite": json.loads(agg.reset_index().to_json(orient="records")),
        "per_file": records,
    }
    (out_dir / "build_summary.json").write_text(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
