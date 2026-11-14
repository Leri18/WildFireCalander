#!/usr/bin/env python3
"""Pack the harmonized cell-month table into compact files for the static web app.

Usage:
    python scripts/build_app_data.py --region Argentina

Reads  data/harmonized/{region}_cell_month.parquet, {region}_monthly.csv, {region}_metrics.json
Writes docs/app/data/meta.json   grid, cell list, months, country-level interval, method summary
       docs/app/data/harm.bin    uint16 [months x cells], harmonized VIIRS-equivalent counts,
                                 stored as round(sqrt(value) * K) so small values keep precision
       docs/app/data/modis.bin   uint16 [modeled months x cells], raw MODIS counts (Terra + Aqua)
                                 for the months before the VIIRS record (used by the "raw" view)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

GRID = 0.25
K = 800.0  # sqrt quantisation: value = (q / K) ** 2, max representable value 6710


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True)
    ap.add_argument("--harmonized", default="data/harmonized")
    ap.add_argument("--out", default="docs/app/data")
    args = ap.parse_args()
    key = args.region.lower()
    src = Path(args.harmonized)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cell = pd.read_parquet(src / f"{key}_cell_month.parquet")
    monthly = pd.read_csv(src / f"{key}_monthly.csv")
    metrics = json.loads((src / f"{key}_metrics.json").read_text())

    months = monthly["month"].tolist()
    t_of = {m: i for i, m in enumerate(months)}
    n_modeled = int((monthly["source"] == "modeled_from_modis").sum())
    if not (monthly["source"].iloc[:n_modeled] == "modeled_from_modis").all():
        raise SystemExit("modeled months are not a leading block")

    lat0 = float(np.floor((cell["cell_lat"].min() - GRID / 2) / GRID + 0.5) * GRID)
    lon0 = float(np.floor((cell["cell_lon"].min() - GRID / 2) / GRID + 0.5) * GRID)
    iy = np.rint((cell["cell_lat"].to_numpy() - GRID / 2 - lat0) / GRID).astype(np.int64)
    ix = np.rint((cell["cell_lon"].to_numpy() - GRID / 2 - lon0) / GRID).astype(np.int64)
    W = int(ix.max()) + 1
    code = iy * W + ix
    codes = np.unique(code)
    cidx = np.searchsorted(codes, code)
    t = cell["month"].astype(str).map(t_of).to_numpy()
    T, N = len(months), len(codes)

    harm = np.zeros((T, N), dtype=np.float64)
    harm[t, cidx] = cell["harmonized_viirs_eq"].to_numpy()
    if harm.max() > (65535 / K) ** 2:
        raise SystemExit("harmonized value exceeds the quantisation range")
    q = np.rint(np.sqrt(harm) * K).astype(np.uint16)
    modis = np.zeros((T, N), dtype=np.int64)
    modis[t, cidx] = (cell["terra_count"] + cell["aqua_count"]).to_numpy()
    if modis.max() > 65535:
        raise SystemExit("MODIS count exceeds uint16")

    # checks against the committed monthly table
    back = (q.astype(np.float64) / K) ** 2
    err = np.abs(back.sum(axis=1) - monthly["harmonized_viirs_eq"].to_numpy())
    rel = err / np.maximum(monthly["harmonized_viirs_eq"].to_numpy(), 1)
    print(f"cells {N}, months {T}, modeled months {n_modeled}")
    print(f"quantisation: max abs error of a monthly country total {err.max():.2f} hotspots "
          f"(max relative {100 * rel.max():.4f} %)")
    if (err > np.maximum(0.5, 0.002 * monthly["harmonized_viirs_eq"].to_numpy())).any():
        raise SystemExit("quantised data does not reproduce the monthly table")
    if not (modis.sum(axis=1) == monthly["modis_count"].to_numpy()).all():
        raise SystemExit("MODIS cell counts do not add up to the monthly table")

    q.tofile(out / "harm.bin")
    modis[:n_modeled].astype(np.uint16).tofile(out / "modis.bin")

    lo = metrics["loyo"]
    meta = {
        "region": args.region,
        "grid": GRID, "lat0": lat0, "lon0": lon0, "width": W,
        "cells": codes.tolist(),
        "months": months,
        "n_modeled": n_modeled,
        "terra_only_until": "2002-06",
        "k": K,
        "country": {
            "harmonized": monthly["harmonized_viirs_eq"].round(1).tolist(),
            "lower": monthly["lower"].round(1).tolist(),
            "upper": monthly["upper"].round(1).tolist(),
        },
        "validation": {
            "design": "leave-one-year-out, 2012-2025, target VIIRS S-NPP",
            "methods": {m: {"mae": round(lo["full"]["summary"][m]["mean_mae"], 1),
                            "r2": round(lo["full"]["summary"][m]["mean_r2"], 3),
                            "median_agreement": round(lo["full"]["summary"][m]["mean_median_agreement"], 3)}
                        for m in ("B0", "B1", "M1")},
            "chosen": metrics["chosen"]["full"],
            "snpp_over_modis": round(metrics["overlap_ratio_snpp_over_modis"]["sum_ratio"], 2),
            "mean_monthly_snpp": round(float(monthly.loc[monthly["source"] == "observed_viirs",
                                                         "snpp_count"].mean()), 0),
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    for f in ("meta.json", "harm.bin", "modis.bin"):
        print(f"  {f}: {(out / f).stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
