#!/usr/bin/env python3
"""Convert a FIRMS API archive (monthly CSV files of one bounding box) to the unified dataset.

Usage:
    python scripts/import_api_archive.py --src data/raw/api/germany --region Germany

Input : {src}/index.json and {src}/{FAMILY}/{PRODUCT}_{YYYY-MM}.csv.gz as written by the
        team's `firms_download.py` (FIRMS API `area` endpoint; products MODIS_SP, MODIS_NRT,
        VIIRS_SNPP_SP, VIIRS_SNPP_NRT, VIIRS_NOAA20_*, VIIRS_NOAA21_*).
Output: data/processed/{region}/sensor=.../year=.../{satellite}.parquet, same schema as
        scripts/build_dataset.py, plus the column `quality` (SP | NRT).

Differences to the yearly country archive that are handled here:
  * `acq_time` has no leading zeros (414 -> 0414).
  * Science-quality (SP) rows win over near-real-time (NRT) rows of the same day.
  * NRT rows have no `type`. A NRT detection within about 1 km of a place that the SP data
    lists as a static land source (type 2) is set to type 2, every other NRT detection to
    type 0. This is a derivation, not a NASA classification; `quality` marks these rows.
  * The area is a bounding box, not a country outline.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_dataset import COLUMNS, modis_confidence_class  # noqa: E402

FAMILIES = {"MODIS": "MODIS", "VIIRS_SNPP": "VIIRS", "VIIRS_NOAA20": "VIIRS", "VIIRS_NOAA21": "VIIRS"}
SATELLITE = {"Terra": "Terra", "Aqua": "Aqua", "N": "S-NPP", "N20": "NOAA-20", "N21": "NOAA-21"}
VIIRS_CONF = {"l": "low", "n": "nominal", "h": "high"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True)
    ap.add_argument("--region", required=True)
    ap.add_argument("--out", default="data/processed")
    args = ap.parse_args()
    src = Path(args.src)
    out_dir = Path(args.out) / args.region.lower()
    index = json.loads((src / "index.json").read_text())

    entries = []
    for key, e in index["files"].items():
        product, month = key.split("/")
        fam = e.get("family")
        path = src / fam / f"{product}_{month}.csv.gz"
        if fam in FAMILIES and path.exists():
            entries.append((fam, month, product.endswith("_NRT"), path, e))
    if not entries:
        raise SystemExit(f"no usable files in {src}")
    entries.sort(key=lambda x: (x[0], x[1], x[2]))

    frames, n_raw, n_dropped_dup = [], 0, 0
    sp_days: dict[str, set] = {}
    for fam, month, is_nrt, path, e in entries:
        raw = pd.read_csv(path, dtype={"acq_time": str, "confidence": str, "version": str,
                                       "satellite": str, "acq_date": str})
        n_raw += len(raw)
        if len(raw) != e["rows"]:
            raise SystemExit(f"{path.name}: {len(raw)} rows parsed, index says {e['rows']}")
        raw = raw[(raw["acq_date"] >= e["from"]) & (raw["acq_date"] <= e["to"])]
        if is_nrt:
            keep = ~raw["acq_date"].isin(sp_days.get(fam, set()))
            n_dropped_dup += int((~keep).sum())
            raw = raw[keep]
        else:
            sp_days.setdefault(fam, set()).update(raw["acq_date"].unique())
        if raw.empty:
            continue
        df = pd.DataFrame()
        df["latitude"] = raw["latitude"].astype("float64")
        df["longitude"] = raw["longitude"].astype("float64")
        hhmm = raw["acq_time"].str.strip().str.zfill(4)
        df["acq_datetime_utc"] = pd.to_datetime(raw["acq_date"] + " " + hhmm,
                                                format="%Y-%m-%d %H%M").astype("datetime64[s]")
        sat = raw["satellite"].str.strip().map(SATELLITE)
        if sat.isna().any():
            raise SystemExit(f"{path.name}: unknown satellite {raw['satellite'][sat.isna()].unique()}")
        df["satellite"] = sat
        conf = raw["confidence"].str.strip()
        df["confidence_raw"] = conf
        if fam == "MODIS":
            df["confidence_class"] = modis_confidence_class(conf)
            df["bt_mir"] = raw["brightness"].astype("float32")
            df["bt_tir"] = raw["bright_t31"].astype("float32")
        else:
            cls = conf.str.lower().map(VIIRS_CONF)
            if cls.isna().any():
                raise SystemExit(f"{path.name}: unknown VIIRS confidence {conf[cls.isna()].unique()}")
            df["confidence_class"] = cls
            df["bt_mir"] = raw["bright_ti4"].astype("float32")
            df["bt_tir"] = raw["bright_ti5"].astype("float32")
        df["frp"] = raw["frp"].astype("float32")
        df["daynight"] = raw["daynight"].str.strip()
        df["version"] = raw["version"].str.strip()
        df["type"] = raw["type"].astype("int8") if "type" in raw.columns else np.int8(-1)
        df["scan"] = raw["scan"].astype("float32")
        df["track"] = raw["track"].astype("float32")
        df["quality"] = "NRT" if is_nrt else "SP"
        df["sensor"] = FAMILIES[fam]
        frames.append(df)
    allp = pd.concat(frames, ignore_index=True)

    # derive a type for NRT rows from the static places known in the SP data (about 1 km)
    ci = np.rint(allp["latitude"].to_numpy() * 100).astype(np.int64)
    cj = np.rint(allp["longitude"].to_numpy() * 100).astype(np.int64)
    is_static = (allp["type"] == 2).to_numpy()
    static = set(zip(ci[is_static].tolist(), cj[is_static].tolist()))
    untyped = np.nonzero((allp["type"] == -1).to_numpy())[0]
    derived = np.zeros(len(untyped), dtype=np.int8)
    for k, i in enumerate(untyped):
        a, b = int(ci[i]), int(cj[i])
        if any((a + da, b + db) in static for da in (-1, 0, 1) for db in (-1, 0, 1)):
            derived[k] = 2
    allp.loc[untyped, "type"] = derived
    allp["type"] = allp["type"].astype("int8")

    saa = (allp["sensor"] == "VIIRS") & (allp["confidence_class"] == "low") & (allp["daynight"] == "N")
    n_saa = int(saa.sum())
    allp = allp[~saa]

    if out_dir.exists():
        shutil.rmtree(out_dir)
    allp["year"] = allp["acq_datetime_utc"].dt.year
    total_bytes = 0
    for (sensor, year, sat), part in allp.groupby(["sensor", "year", "satellite"]):
        target = out_dir / f"sensor={sensor}" / f"year={year}"
        target.mkdir(parents=True, exist_ok=True)
        p = part.sort_values("acq_datetime_utc")[COLUMNS + ["quality"]].copy()
        for c in ("satellite", "confidence_class", "daynight", "version", "quality"):
            p[c] = p[c].astype("category")
        p.to_parquet(target / f"{sat}.parquet", compression="zstd", index=False)
        total_bytes += (target / f"{sat}.parquet").stat().st_size

    tab = allp.groupby("satellite").agg(
        rows=("type", "size"), first=("acq_datetime_utc", "min"), last=("acq_datetime_utc", "max"),
        type0=("type", lambda s: int((s == 0).sum())), type2=("type", lambda s: int((s == 2).sum())),
        type3=("type", lambda s: int((s == 3).sum())), nrt=("quality", lambda s: int((s == "NRT").sum())))
    tab["type0_pct"] = (100 * tab["type0"] / tab["rows"]).round(1)
    print(tab.to_string())
    print(f"\nfiles: {len(entries)}  raw rows: {n_raw}  NRT rows dropped because SP exists: {n_dropped_dup}")
    print(f"written: {len(allp)}  VIIRS low-confidence night rows excluded: {n_saa}")
    print(f"NRT rows typed by derivation: {len(untyped)} ({int((derived == 2).sum())} static, "
          f"{int((derived == 0).sum())} vegetation)")
    print(f"static places (0.01 deg) known from SP: {len(static)}   parquet: {total_bytes / 1e6:.1f} MB")
    summary = {
        "region": args.region, "area_bbox_w_s_e_n": index.get("area"), "n_files": len(entries),
        "rows_raw_total": int(n_raw), "nrt_rows_dropped_sp_exists": int(n_dropped_dup),
        "rows_written_total": int(len(allp)), "viirs_low_night_excluded_total": n_saa,
        "nrt_rows_typed_by_derivation": int(len(untyped)),
        "nrt_rows_derived_static": int((derived == 2).sum()),
        "per_satellite": json.loads(tab.reset_index().astype({"first": str, "last": str}).to_json(orient="records")),
    }
    (out_dir / "build_summary.json").write_text(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
