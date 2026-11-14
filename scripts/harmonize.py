#!/usr/bin/env python3
"""MODIS -> VIIRS-equivalent harmonization experiment on a 0.25 deg x calendar-month grid.

Usage:
    python scripts/harmonize.py --region Argentina

Reads  data/processed/{region}/ (built by scripts/build_dataset.py) and writes
    data/harmonized/{region}_monthly.csv          harmonized burning-activity calendar
    data/harmonized/{region}_cell_month.parquet   cell-month table (only if < 20 MB)
    data/harmonized/{region}_loyo_metrics.csv     per-year leave-one-year-out metrics
    data/harmonized/{region}_loyo_predictions.csv out-of-sample region-month predictions
    data/harmonized/{region}_metrics.json         every number quoted in the report
    docs/figures/*.png

Target: VIIRS S-NPP hotspot count per cell-month. Overlap: 2012-02 ... 2025-12.
Methods (all validated leave-one-year-out, never with random row splits):
    B0  one constant factor  k   = sum(S-NPP) / sum(MODIS)
    B1  one factor per calendar month
    M1  gradient boosting, Poisson loss, MODIS-only features
Each method exists in a "full" variant (Terra+Aqua features, used from 2002-07) and a
"terra" variant (Terra-only features, used for 2000-11 ... 2002-06, before Aqua).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LogNorm
from sklearn.ensemble import HistGradientBoostingRegressor

GRID = 0.25
Y0, M0 = 2000, 11            # first month of the record (Terra)
Y1, M1_ = 2025, 12           # last month of the yearly archive
OVERLAP_START = (2012, 2)    # first full S-NPP month
AQUA_START = (2002, 7)       # first month with Aqua data
N20_START = (2018, 4)
DEV_FLOOR = 0.01             # floor for mu in the Poisson deviance (B0/B1 predict exact zeros)
PI_Q = (0.05, 0.95)          # 90 % interval from out-of-sample residuals
HGB_PARAMS = dict(loss="poisson", learning_rate=0.05, max_iter=400, max_leaf_nodes=31,
                  min_samples_leaf=40, l2_regularization=1.0, early_stopping=False,
                  random_state=0)

# chart tokens (colour-blind-safe categorical slots, validated; cividis for magnitude)
SURF, INK, INK2, GRIDC = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
C_MODIS, C_SNPP, C_N20, C_HARM = "#2a78d6", "#eb6834", "#1baf7a", "#6250d6"


def mi(year: int, month: int) -> int:
    return (year - Y0) * 12 + (month - 1) - (M0 - 1)


T_OV0, T_AQUA, T_N20 = mi(*OVERLAP_START), mi(*AQUA_START), mi(*N20_START)
YV1 = Y1                     # last validation year (the yearly archive ends 2025-12)
T_OVE = mi(Y1, M1_) + 1      # end of the overlap / validation period (exclusive), fixed at 2025-12


def configure(end_year: int = Y1, end_month: int = M1_) -> None:
    """Set the last month of the record. Months after 2025-12 are not used for training or
    validation; they are only appended to the calendar as observed VIIRS months."""
    global T, MONTH_YEAR, MONTH_CAL, MONTH_LABEL, Y1
    T = mi(end_year, end_month) + 1
    if T < T_OVE:
        raise SystemExit("the record must reach at least 2025-12")
    MONTH_YEAR = np.array([Y0 + (t + M0 - 1) // 12 for t in range(T)])
    MONTH_CAL = np.array([(t + M0 - 1) % 12 + 1 for t in range(T)])
    MONTH_LABEL = np.array([f"{y}-{m:02d}" for y, m in zip(MONTH_YEAR, MONTH_CAL)])
    Y1 = end_year


configure()


# --------------------------------------------------------------------------- data
def load_points(region: str, processed: Path) -> pd.DataFrame:
    root = processed / region.lower()
    files = sorted(root.glob("sensor=*/year=*/*.parquet"))
    if not files:
        raise SystemExit(f"no processed data in {root}; run scripts/build_dataset.py first")
    cols = ["latitude", "longitude", "acq_datetime_utc", "satellite", "confidence_class",
            "frp", "daynight", "type", "scan"]
    parts = []
    for f in files:
        p = pd.read_parquet(f, columns=cols)
        for c in ("satellite", "confidence_class", "daynight"):
            p[c] = p[c].astype(str)
        parts.append(p)
    df = pd.concat(parts, ignore_index=True)
    dt = df["acq_datetime_utc"]
    df["t"] = ((dt.dt.year - Y0) * 12 + dt.dt.month - 1 - (M0 - 1)).astype(np.int32)
    df = df[(df["t"] >= 0) & (df["t"] < T)].reset_index(drop=True)
    return df


class Grid:
    def __init__(self, df: pd.DataFrame):
        self.lat0 = np.floor(df["latitude"].min() / GRID) * GRID
        self.lon0 = np.floor(df["longitude"].min() / GRID) * GRID
        self.H = int(np.floor((df["latitude"].max() - self.lat0) / GRID)) + 1
        self.W = int(np.floor((df["longitude"].max() - self.lon0) / GRID)) + 1
        self.lat_c = self.lat0 + (np.arange(self.H) + 0.5) * GRID
        self.lon_c = self.lon0 + (np.arange(self.W) + 0.5) * GRID

    def flat(self, df: pd.DataFrame) -> np.ndarray:
        iy = np.floor((df["latitude"].to_numpy() - self.lat0) / GRID).astype(np.int64)
        ix = np.floor((df["longitude"].to_numpy() - self.lon0) / GRID).astype(np.int64)
        return (df["t"].to_numpy().astype(np.int64) * self.H + iy) * self.W + ix

    def cube(self, flat: np.ndarray, weights=None) -> np.ndarray:
        n = T * self.H * self.W
        return np.bincount(flat, weights=weights, minlength=n).reshape(T, self.H, self.W) \
            .astype(np.float32)

    def cube_max(self, flat: np.ndarray, values: np.ndarray) -> np.ndarray:
        out = np.zeros(T * self.H * self.W, dtype=np.float32)
        np.maximum.at(out, flat, values.astype(np.float32))
        return out.reshape(T, self.H, self.W)


def source_features(g: Grid, d: pd.DataFrame, flat: np.ndarray, prefix: str,
                    clim_years: tuple[int, int]) -> dict[str, np.ndarray]:
    """Cell-month features from one MODIS source (Terra+Aqua, or Terra only)."""
    n = g.cube(flat)
    day = g.cube(flat[(d["daynight"] == "D").to_numpy()])
    frp = d["frp"].to_numpy().astype(np.float64)
    frp_sum = g.cube(flat, frp)
    with np.errstate(invalid="ignore", divide="ignore"):
        frp_mean = np.where(n > 0, frp_sum / n, np.nan).astype(np.float32)
        scan_mean = np.where(n > 0, g.cube(flat, d["scan"].to_numpy().astype(np.float64)) / n,
                             np.nan).astype(np.float32)
    f = {
        f"{prefix}_n": n,
        f"{prefix}_day_n": day,
        f"{prefix}_night_n": n - day,
        f"{prefix}_frp_sum": frp_sum,
        f"{prefix}_frp_mean": frp_mean,
        f"{prefix}_frp_max": g.cube_max(flat, frp),
        f"{prefix}_scan_mean": scan_mean,
    }
    for c in ("low", "nominal", "high"):
        f[f"{prefix}_conf_{c}_n"] = g.cube(flat[(d["confidence_class"] == c).to_numpy()])
    # spatial context: detections in the 8 neighbouring cells, same month
    pad = np.pad(n, ((0, 0), (1, 1), (1, 1)))
    neigh = sum(pad[:, 1 + dy:1 + dy + g.H, 1 + dx:1 + dx + g.W]
                for dy in (-1, 0, 1) for dx in (-1, 0, 1)) - n
    f[f"{prefix}_neigh_n"] = neigh.astype(np.float32)
    # temporal context: same cell, previous / next month (NaN outside the record)
    prev = np.full_like(n, np.nan)
    prev[1:] = n[:-1]
    nxt = np.full_like(n, np.nan)
    nxt[:-1] = n[1:]
    f[f"{prefix}_prev_n"] = prev
    f[f"{prefix}_next_n"] = nxt
    # MODIS-only climatology of the cell for this calendar month (complete years only)
    sel = (MONTH_YEAR >= clim_years[0]) & (MONTH_YEAR <= clim_years[1])
    clim = np.zeros((12, g.H, g.W), dtype=np.float32)
    for m in range(1, 13):
        clim[m - 1] = n[sel & (MONTH_CAL == m)].mean(axis=0)
    f[f"{prefix}_clim_n"] = clim[MONTH_CAL - 1]
    f[f"{prefix}_cellmean_n"] = np.broadcast_to(clim.mean(axis=0), n.shape)
    return f


def prepare(df: pd.DataFrame, g: Grid) -> dict:
    sat = df["satellite"].to_numpy()
    flat = g.flat(df)
    is_modis = (sat == "Terra") | (sat == "Aqua")
    cubes = {s: g.cube(flat[sat == s]) for s in ("Terra", "Aqua", "S-NPP", "NOAA-20")}
    cubes["MODIS"] = cubes["Terra"] + cubes["Aqua"]
    full = source_features(g, df[is_modis], flat[is_modis], "modis", (2003, YV1))
    full["terra_n"] = cubes["Terra"]
    full["aqua_n"] = cubes["Aqua"]
    terra = source_features(g, df[sat == "Terra"], flat[sat == "Terra"], "terra", (2001, YV1))
    shape = (T, g.H, g.W)
    common = {
        "month": np.broadcast_to(MONTH_CAL[:, None, None].astype(np.float32), shape),
        "lat": np.broadcast_to(g.lat_c[None, :, None].astype(np.float32), shape),
        "lon": np.broadcast_to(g.lon_c[None, None, :].astype(np.float32), shape),
    }
    full.update(common)
    terra.update(common)
    return {"cubes": cubes, "feat": {"full": full, "terra": terra},
            "base": {"full": cubes["MODIS"], "terra": cubes["Terra"]}}


def panel(prep: dict, variant: str, t_idx: np.ndarray, cellmask: np.ndarray):
    """Dense panel (all cells x all months, zeros kept). Rows ordered month-major."""
    feat = prep["feat"][variant]
    names = list(feat)
    X = np.stack([feat[k][t_idx][:, cellmask].ravel() for k in names], axis=1)
    ncell = int(cellmask.sum())
    rows_t = np.repeat(t_idx, ncell)
    base = prep["base"][variant][t_idx][:, cellmask].ravel().astype(np.float64)
    return X, names, rows_t, base


# ------------------------------------------------------------------------ methods
CLIP_LOG: list[tuple[int, float, float]] = []   # (n clipped, max raw prediction, cap) per M1 fit


def clip_stats(start: int) -> dict:
    part = CLIP_LOG[start:]
    return {"m1_fits": len(part), "cell_predictions_clipped": int(sum(p[0] for p in part)),
            "max_raw_cell_prediction": float(max((p[1] for p in part), default=0.0)),
            "min_cap": float(min((p[2] for p in part), default=0.0))}


def fit_predict(method: str, Xtr, ytr, btr, ttr, Xte, bte, tte) -> np.ndarray:
    if method == "B0":
        return (ytr.sum() / btr.sum()) * bte
    if method == "B1":
        k = np.zeros(13)
        for m in range(1, 13):
            sel = MONTH_CAL[ttr] == m
            k[m] = ytr[sel].sum() / btr[sel].sum()
        return k[MONTH_CAL[tte]] * bte
    if method == "M1":
        model = HistGradientBoostingRegressor(**HGB_PARAMS)
        model.fit(Xtr, ytr)
        pred = model.predict(Xte)
        # Range guard: with a log link, a rare feature combination can produce an absurd
        # cell value (seen once: 353,020 predicted for a cell-month with 351 observed).
        # A cell prediction may never exceed the largest target value seen in training.
        cap = float(ytr.max())
        CLIP_LOG.append((int((pred > cap).sum()), float(pred.max()), cap))
        return np.minimum(pred, cap)
    raise ValueError(method)


def region_series(values: np.ndarray, rows_t: np.ndarray) -> np.ndarray:
    return np.bincount(rows_t, weights=values, minlength=T)


def poisson_deviance(y: np.ndarray, mu: np.ndarray) -> float:
    mu = np.maximum(mu, DEV_FLOOR)
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(y > 0, y * np.log(y / mu), 0.0)
    return float(2.0 * np.mean(term - (y - mu)))


def r2(obs: np.ndarray, pred: np.ndarray) -> float:
    sst = float(((obs - obs.mean()) ** 2).sum())
    return float(1.0 - ((obs - pred) ** 2).sum() / sst) if sst > 0 else float("nan")


def above_median_flags(series: np.ndarray, t_idx: np.ndarray, ref: np.ndarray | None = None):
    """Per month: is the value above the multi-year median of its calendar month?
    Medians are taken over `t_idx` of `ref` (default: the series itself)."""
    ref = series if ref is None else ref
    flags = np.zeros(T, dtype=bool)
    for m in range(1, 13):
        sel = t_idx[MONTH_CAL[t_idx] == m]
        flags[sel] = series[sel] > np.median(ref[sel])
    return flags


def loyo(prep: dict, variant: str, cellmask: np.ndarray, modis_cellmask: np.ndarray,
         methods=("B0", "B1", "M1")) -> dict:
    t_idx = np.arange(T_OV0, T_OVE)
    X, names, rows_t, base = panel(prep, variant, t_idx, cellmask)
    y = prep["cubes"]["S-NPP"][t_idx][:, cellmask].ravel().astype(np.float64)
    years = MONTH_YEAR[rows_t]
    in_modis_cell = np.tile(modis_cellmask[cellmask], len(t_idx))
    oos = {m: np.zeros(len(y)) for m in methods}
    clip_start = len(CLIP_LOG)
    for yr in range(OVERLAP_START[0], YV1 + 1):
        te = years == yr
        tr = ~te
        for m in methods:
            t0 = time.time()
            oos[m][te] = fit_predict(m, X[tr], y[tr], base[tr], rows_t[tr], X[te], base[te], rows_t[te])
            if m == "M1":
                print(f"    [{variant}] held-out {yr}: M1 fit+predict {time.time() - t0:.0f} s", flush=True)
    obs = region_series(y, rows_t)
    n20 = prep["cubes"]["NOAA-20"][:, cellmask].sum(axis=1).astype(np.float64)
    out = {"variant": variant, "features": names, "n_rows": int(len(y)),
           "n_cells": int(cellmask.sum()), "n_months": int(len(t_idx)),
           "obs": obs, "series": {}, "per_year": [], "summary": {}, "n20": {},
           "cell_oos": oos, "rows_t": rows_t, "y": y, "range_guard": clip_stats(clip_start)}
    flags_obs = above_median_flags(obs, t_idx)
    t_n20 = np.arange(T_N20, T_OVE)
    flags_n20 = above_median_flags(n20, t_n20)
    for m in methods:
        pred = region_series(oos[m], rows_t)
        out["series"][m] = pred
        f_own = above_median_flags(pred, t_idx)
        f_obsmed = above_median_flags(pred, t_idx, ref=obs)
        rows = []
        for yr in range(OVERLAP_START[0], YV1 + 1):
            tt = t_idx[MONTH_YEAR[t_idx] == yr]
            te = years == yr
            rows.append({
                "variant": variant, "method": m, "year": yr, "n_months": int(len(tt)),
                "mae": float(np.abs(pred[tt] - obs[tt]).mean()),
                "bias": float((pred[tt] - obs[tt]).mean()),
                "rel_bias_pct": float(100 * (pred[tt].sum() / obs[tt].sum() - 1)),
                "r2": r2(obs[tt], pred[tt]),
                "poisson_deviance": poisson_deviance(y[te], oos[m][te]),
                "cell_mae": float(np.abs(oos[m][te] - y[te]).mean()),
                "median_agreement": float((f_own[tt] == flags_obs[tt]).mean()),
                "median_agreement_vs_obs_median": float((f_obsmed[tt] == flags_obs[tt]).mean()),
            })
        out["per_year"] += rows
        pr = pd.DataFrame(rows)
        keys = ["mae", "bias", "rel_bias_pct", "r2", "poisson_deviance", "cell_mae",
                "median_agreement", "median_agreement_vs_obs_median"]
        summ = {f"mean_{k}": float(pr[k].mean()) for k in keys}
        summ.update({
            "pooled_mae": float(np.abs(pred[t_idx] - obs[t_idx]).mean()),
            "pooled_bias": float((pred[t_idx] - obs[t_idx]).mean()),
            "pooled_rel_bias_pct": float(100 * (pred[t_idx].sum() / obs[t_idx].sum() - 1)),
            "pooled_r2": r2(obs[t_idx], pred[t_idx]),
            "pooled_r2_log1p": r2(np.log1p(obs[t_idx]), np.log1p(pred[t_idx])),
            "pooled_median_agreement": float((f_own[t_idx] == flags_obs[t_idx]).mean()),
            "pooled_median_agreement_vs_obs_median":
                float((f_obsmed[t_idx] == flags_obs[t_idx]).mean()),
            "pooled_poisson_deviance": poisson_deviance(y, oos[m]),
            "share_snpp_in_cellmonths_predicted_zero":
                float(y[oos[m] <= 0].sum() / y.sum()),
            # same region sums, but only over cells with >= 1 MODIS detection in the overlap
            "rel_bias_pct_modis_cells_only": float(100 * (
                oos[m][in_modis_cell].sum() / y.sum() - 1)),
        })
        lr = np.log((obs[t_idx] + 1) / (pred[t_idx] + 1))
        summ["logratio_q05"], summ["logratio_q95"] = (float(np.quantile(lr, q)) for q in PI_Q)
        out["summary"][m] = summ
        # transfer: same out-of-sample predictions against NOAA-20
        fp = above_median_flags(pred, t_n20)
        out["n20"][m] = {
            "mae": float(np.abs(pred[t_n20] - n20[t_n20]).mean()),
            "bias": float((pred[t_n20] - n20[t_n20]).mean()),
            "rel_bias_pct": float(100 * (pred[t_n20].sum() / n20[t_n20].sum() - 1)),
            "r2": r2(n20[t_n20], pred[t_n20]),
            "median_agreement": float((fp[t_n20] == flags_n20[t_n20]).mean()),
            "n_months": int(len(t_n20)),
        }
    return out


def choose(summary: dict) -> str:
    """Lowest mean leave-one-year-out region-month MAE wins; M1 must beat B1 to be used."""
    mae = {m: summary[m]["mean_mae"] for m in summary}
    best_baseline = "B1" if mae["B1"] <= mae["B0"] else "B0"
    return "M1" if mae["M1"] < mae[best_baseline] else best_baseline


# ------------------------------------------------------------------------ figures
def style(ax, ylog=False):
    ax.set_facecolor(SURF)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRIDC)
    ax.tick_params(colors=INK2, labelsize=9, length=0)
    ax.grid(axis="y", color=GRIDC, linewidth=0.8)
    ax.set_axisbelow(True)
    if ylog:
        ax.set_yscale("log")


def month_dates(t_idx):
    return pd.to_datetime([MONTH_LABEL[t] + "-15" for t in t_idx])


def nan_before(series: np.ndarray, t_start: int) -> np.ndarray:
    s = series.astype(float).copy()
    s[:t_start] = np.nan
    return s


def fig_raw(region, modis, snpp, n20, out: Path):
    fig, (a, b) = plt.subplots(2, 1, figsize=(11, 6.6), sharex=True, facecolor=SURF,
                               gridspec_kw={"height_ratios": [2.2, 1]})
    t = np.arange(T)
    d = month_dates(t)
    a.plot(d, modis, color=C_MODIS, lw=1.6, label="MODIS (Terra + Aqua, 1 km)")
    a.plot(d, nan_before(snpp, T_OV0), color=C_SNPP, lw=1.6, label="VIIRS S-NPP (375 m)")
    a.plot(d, nan_before(n20, T_N20), color=C_N20, lw=1.2, label="VIIRS NOAA-20 (375 m)")
    style(a, ylog=True)
    a.set_ylabel("hotspots per month (log scale)", color=INK2, fontsize=9)
    a.set_title(f"{region}: raw monthly hotspot counts are not comparable across sensors",
                loc="left", color=INK, fontsize=12, fontweight="bold")
    a.legend(frameon=False, fontsize=9, ncol=3, loc="upper left", labelcolor=INK2)
    ov = np.arange(T_OV0, T_OVE)
    ratio = snpp[ov] / modis[ov]
    b.plot(month_dates(ov), ratio, color=INK2, lw=1.4)
    b.axhline(np.median(ratio), color=GRIDC, lw=1.2, ls="--")
    b.annotate(f"median {np.median(ratio):.2f}", (month_dates(ov)[-1], np.median(ratio)),
               xytext=(4, 3), textcoords="offset points", fontsize=8, color=INK2)
    style(b)
    b.set_ylabel("S-NPP / MODIS", color=INK2, fontsize=9)
    b.set_title("Monthly ratio S-NPP / MODIS in the overlap period: not a constant",
                loc="left", color=INK, fontsize=10)
    fig.tight_layout()
    fig.savefig(out, dpi=160, facecolor=SURF)
    plt.close(fig)


def fig_heldout(region, res, chosen, out: Path):
    t = np.arange(T_OV0, T_OVE)
    d = month_dates(t)
    obs = res["obs"][t]
    fig = plt.figure(figsize=(11, 7.4), facecolor=SURF)
    gs = fig.add_gridspec(2, 3, height_ratios=[1.25, 1])
    a = fig.add_subplot(gs[0, :])
    a.plot(d, obs, color=C_SNPP, lw=1.8, label="observed VIIRS S-NPP")
    a.plot(d, res["series"][chosen][t], color=C_HARM, lw=1.4,
           label=f"harmonized MODIS, {chosen} (year held out)")
    style(a, ylog=True)
    a.set_ylabel("hotspots per month (log scale)", color=INK2, fontsize=9)
    a.set_title(f"{region}: harmonized MODIS vs observed S-NPP, every year predicted "
                "without seeing it", loc="left", color=INK, fontsize=12, fontweight="bold")
    a.legend(frameon=False, fontsize=9, ncol=2, loc="upper left", labelcolor=INK2)
    lim = (max(1.0, min(obs.min(), min(res["series"][m][t].min() for m in res["series"])) * 0.8),
           max(obs.max(), max(res["series"][m][t].max() for m in res["series"])) * 1.25)
    for i, m in enumerate(("B0", "B1", "M1")):
        ax = fig.add_subplot(gs[1, i])
        ax.scatter(obs, res["series"][m][t], s=14, color=C_HARM, alpha=0.75,
                   edgecolors=SURF, linewidths=0.4)
        ax.plot(lim, lim, color=INK2, lw=0.9, ls="--")
        ax.set_xscale("log")
        style(ax, ylog=True)
        ax.grid(axis="x", color=GRIDC, linewidth=0.8)
        ax.set_xlim(lim)
        ax.set_ylim(lim)
        s = res["summary"][m]
        ax.set_title(f"{m}{'  (chosen)' if m == chosen else ''}\nmean MAE {s['mean_mae']:,.0f} · "
                     f"pooled R² {s['pooled_r2']:.3f}", loc="left", color=INK, fontsize=10)
        ax.set_xlabel("observed S-NPP per month", color=INK2, fontsize=9)
        if i == 0:
            ax.set_ylabel("harmonized (held-out)", color=INK2, fontsize=9)
    fig.tight_layout()
    fig.savefig(out, dpi=160, facecolor=SURF)
    plt.close(fig)


def fig_calendar(region, monthly: pd.DataFrame, out: Path):
    years = np.arange(Y0, Y1 + 1)
    mat = np.full((len(years), 12), np.nan)
    for _, r in monthly.iterrows():
        y, m = int(r["month"][:4]), int(r["month"][5:7])
        mat[y - Y0, m - 1] = max(r["harmonized_viirs_eq"], 1.0)
    fig, ax = plt.subplots(figsize=(8.6, 9.2), facecolor=SURF)
    cmap = plt.get_cmap("cividis").copy()
    cmap.set_bad("#ffffff")
    im = ax.imshow(mat, cmap=cmap, norm=LogNorm(vmin=np.nanmin(mat), vmax=np.nanmax(mat)),
                   aspect="auto")
    ax.set_xticks(range(12), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
                              "Oct", "Nov", "Dec"])
    ax.set_yticks(range(len(years)), years)
    ax.tick_params(colors=INK2, labelsize=9, length=0)
    ax.set_xticks(np.arange(-0.5, 12), minor=True)
    ax.set_yticks(np.arange(-0.5, len(years)), minor=True)
    ax.grid(which="minor", color=SURF, linewidth=1.5)
    ax.tick_params(which="minor", length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    # boundary between modeled (MODIS-based) and observed (VIIRS) months
    yb, mb = OVERLAP_START[0] - Y0, OVERLAP_START[1] - 1
    ax.plot([-0.5, mb - 0.5, mb - 0.5, 11.5], [yb + 0.5, yb + 0.5, yb - 0.5, yb - 0.5],
            color="#ffffff", lw=3.2)
    ax.plot([-0.5, mb - 0.5, mb - 0.5, 11.5], [yb + 0.5, yb + 0.5, yb - 0.5, yb - 0.5],
            color=INK, lw=1.4)
    ax.annotate("above the line: modeled from MODIS\nbelow the line: observed VIIRS S-NPP",
                (1.02, 1 - (yb + 0.5) / len(years)), xycoords="axes fraction", fontsize=8,
                color=INK2, va="center")
    cb = fig.colorbar(im, ax=ax, orientation="horizontal", pad=0.045, fraction=0.035, aspect=40)
    cb.set_label("VIIRS-equivalent hotspots per month (log scale)", color=INK2, fontsize=9)
    cb.ax.tick_params(colors=INK2, labelsize=8, length=0)
    cb.outline.set_visible(False)
    ax.set_title(f"{region}: harmonized burning-activity calendar, {MONTH_LABEL[0]} to "
                 f"{MONTH_LABEL[-1]}", loc="left", color=INK, fontsize=12, fontweight="bold")
    fig.tight_layout()
    fig.savefig(out, dpi=160, facecolor=SURF, bbox_inches="tight")
    plt.close(fig)


def fig_step(region, terra, modis, monthly: pd.DataFrame, out: Path):
    t = np.arange(0, mi(2004, 12) + 1)
    d = month_dates(t)
    fig, (a, b) = plt.subplots(2, 1, figsize=(11, 6.6), sharex=True, facecolor=SURF)
    a.plot(d, modis[t], color=C_MODIS, lw=1.8, label="MODIS total (Terra, + Aqua from 2002-07)")
    a.plot(d, terra[t], color=INK2, lw=1.2, ls="--", label="Terra only")
    style(a)
    a.set_ylabel("raw hotspots per month", color=INK2, fontsize=9)
    a.set_title(f"{region}: the 2002 step. Before: raw MODIS counts jump when Aqua joins",
                loc="left", color=INK, fontsize=12, fontweight="bold")
    a.legend(frameon=False, fontsize=9, ncol=1, loc="upper left", labelcolor=INK2)
    h = monthly.iloc[t]
    b.fill_between(d, h["lower"], h["upper"], color=C_HARM, alpha=0.18, linewidth=0,
                   label="90 % interval (out-of-sample residuals)")
    b.plot(d, h["harmonized_viirs_eq"], color=C_HARM, lw=1.8, label="harmonized VIIRS-equivalent")
    style(b)
    b.set_ylabel("VIIRS-equivalent hotspots per month", color=INK2, fontsize=9)
    b.set_title("After: Terra-only model until 2002-06, Terra+Aqua model from 2002-07",
                loc="left", color=INK, fontsize=10)
    b.legend(frameon=False, fontsize=9, ncol=2, loc="upper left", labelcolor=INK2)
    for ax in (a, b):
        ax.axvline(pd.Timestamp("2002-07-01"), color=INK2, lw=0.9, ls=":")
    a.annotate("Aqua starts", (pd.Timestamp("2002-07-01"), a.get_ylim()[1]), xytext=(4, -10),
               textcoords="offset points", fontsize=8, color=INK2)
    fig.tight_layout()
    fig.savefig(out, dpi=160, facecolor=SURF)
    plt.close(fig)


# --------------------------------------------------------------------------- main
def to_native(o):
    if isinstance(o, dict):
        return {str(k): to_native(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [to_native(v) for v in o]
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    return o


def strip(res: dict) -> dict:
    return {k: v for k, v in res.items() if k in ("variant", "features", "n_rows", "n_cells",
                                                   "n_months", "summary", "n20", "range_guard")}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True)
    ap.add_argument("--processed", default="data/processed")
    ap.add_argument("--out", default="data/harmonized")
    ap.add_argument("--figures", default="docs/figures")
    ap.add_argument("--end", default="2025-12", metavar="YYYY-MM",
                    help="last month of the calendar; months after 2025-12 are appended as observed")
    ap.add_argument("--method", default="auto", choices=["auto", "B0", "B1", "M1"],
                    help="method for the final calendar; auto = lowest leave-one-year-out MAE")
    ap.add_argument("--skip-sensitivity", action="store_true",
                    help="skip the all-types rerun (saves about a third of the run time)")
    args = ap.parse_args()
    region = args.region
    configure(int(args.end[:4]), int(args.end[5:7]))
    key = region.lower()
    out = Path(args.out)
    figs = Path(args.figures)
    out.mkdir(parents=True, exist_ok=True)
    figs.mkdir(parents=True, exist_ok=True)

    print("loading points ...", flush=True)
    pts_all = load_points(region, Path(args.processed))
    g = Grid(pts_all)
    pts = pts_all[pts_all["type"] == 0].reset_index(drop=True)
    print(f"  {len(pts_all)} detections, {len(pts)} with type == 0; grid {g.H} x {g.W} cells, "
          f"{T} months", flush=True)
    prep = prepare(pts, g)
    cubes = prep["cubes"]
    M: dict = {"region": region, "grid_deg": GRID, "n_months_record": T,
               "first_month": MONTH_LABEL[0], "last_month": MONTH_LABEL[-1],
               "overlap": [MONTH_LABEL[T_OV0], MONTH_LABEL[T_OVE - 1]],
               "n_detections_all_types": int(len(pts_all)), "n_detections_type0": int(len(pts)),
               "hgb_params": HGB_PARAMS, "deviance_floor": DEV_FLOOR, "interval_quantiles": PI_Q}

    # panels ------------------------------------------------------------------
    ov = slice(T_OV0, T_OVE)
    train_cells = (cubes["MODIS"][ov] + cubes["S-NPP"][ov] + cubes["NOAA-20"][ov]).sum(axis=0) > 0
    modis_cells_ov = cubes["MODIS"][ov].sum(axis=0) > 0
    pred_cells = cubes["MODIS"][:T_OV0].sum(axis=0) > 0          # >= 1 MODIS detection, 2000-11..2012-01
    snpp_ov = cubes["S-NPP"][ov]
    M["panel"] = {
        "train_cells": int(train_cells.sum()),
        "train_rows": int(train_cells.sum() * (T_OVE - T_OV0)),
        "train_cells_with_modis": int(modis_cells_ov.sum()),
        "pred_cells_modis_2000_2012": int(pred_cells.sum()),
        "pred_cells_not_in_train_panel": int((pred_cells & ~train_cells).sum()),
        "share_snpp_in_cells_never_seen_by_modis":
            float(snpp_ov[:, train_cells & ~modis_cells_ov].sum() / snpp_ov.sum()),
        "share_snpp_in_cellmonths_with_zero_modis":
            float(snpp_ov[cubes["MODIS"][ov] == 0].sum() / snpp_ov.sum()),
        "share_train_rows_snpp_zero": float(1 - (snpp_ov[:, train_cells] > 0).mean()),
    }
    print("panel:", M["panel"], flush=True)

    # orientation values (compare with the 2020 numbers measured beforehand) ----
    reg = {s: cubes[s].sum(axis=(1, 2)).astype(np.float64) for s in cubes}
    t20 = np.arange(mi(2020, 1), mi(2020, 12) + 1)
    night = {}
    for name, sel in (("MODIS", pts["satellite"].isin(["Terra", "Aqua"])),
                      ("S-NPP", pts["satellite"] == "S-NPP")):
        p = pts[sel & (pts["acq_datetime_utc"].dt.year == 2020)]
        night[name] = float((p["daynight"] == "N").mean())
    M["orientation_2020"] = {
        "snpp_over_modis_monthly_min": float((reg["S-NPP"][t20] / reg["MODIS"][t20]).min()),
        "snpp_over_modis_monthly_max": float((reg["S-NPP"][t20] / reg["MODIS"][t20]).max()),
        "snpp_over_aqua_monthly_min": float((reg["S-NPP"][t20] / reg["Aqua"][t20]).min()),
        "snpp_over_aqua_monthly_max": float((reg["S-NPP"][t20] / reg["Aqua"][t20]).max()),
        "night_share_modis": night["MODIS"], "night_share_snpp": night["S-NPP"],
    }
    tov = np.arange(T_OV0, T_OVE)
    ratio = reg["S-NPP"][tov] / reg["MODIS"][tov]
    M["overlap_ratio_snpp_over_modis"] = {
        "sum_ratio": float(reg["S-NPP"][tov].sum() / reg["MODIS"][tov].sum()),
        "monthly_min": float(ratio.min()), "monthly_median": float(np.median(ratio)),
        "monthly_max": float(ratio.max()),
        "by_calendar_month": {int(m): float(reg["S-NPP"][tov][MONTH_CAL[tov] == m].sum()
                                            / reg["MODIS"][tov][MONTH_CAL[tov] == m].sum())
                              for m in range(1, 13)},
        "by_year": {int(y): float(reg["S-NPP"][tov][MONTH_YEAR[tov] == y].sum()
                                  / reg["MODIS"][tov][MONTH_YEAR[tov] == y].sum())
                    for y in range(OVERLAP_START[0], YV1 + 1)},
    }
    print("orientation 2020:", M["orientation_2020"], flush=True)

    # leave-one-year-out ---------------------------------------------------------
    print("LOYO full variant (Terra+Aqua features) ...", flush=True)
    res_full = loyo(prep, "full", train_cells, modis_cells_ov)
    print("LOYO terra variant (Terra-only features) ...", flush=True)
    res_terra = loyo(prep, "terra", train_cells, modis_cells_ov)
    chosen_full = choose(res_full["summary"]) if args.method == "auto" else args.method
    chosen_terra = choose(res_terra["summary"]) if args.method == "auto" else args.method
    M["loyo"] = {"full": strip(res_full), "terra": strip(res_terra)}
    M["chosen"] = {"full": chosen_full, "terra": chosen_terra,
                   "by_mae_rule": {"full": choose(res_full["summary"]), "terra": choose(res_terra["summary"])},
                   "override": None if args.method == "auto" else args.method,
                   "rule": "lowest mean leave-one-year-out region-month MAE; "
                           "M1 only if it beats the better baseline"}
    per_year = pd.DataFrame(res_full["per_year"] + res_terra["per_year"])
    per_year.to_csv(out / f"{key}_loyo_metrics.csv", index=False, float_format="%.4f")
    for res in (res_full, res_terra):
        print(f"\n=== LOYO mean, variant {res['variant']} ===")
        print(pd.DataFrame(res["summary"]).T[["mean_mae", "mean_bias", "mean_r2", "pooled_r2",
              "mean_poisson_deviance", "mean_median_agreement"]].round(3).to_string())
    print(f"chosen: full={chosen_full}, terra={chosen_terra}", flush=True)

    # Terra-model vs full-model consistency inside the overlap (both out-of-sample)
    M["terra_vs_full_overlap"] = {
        m: {"sum_ratio_terra_over_full": float(res_terra["series"][m][tov].sum()
                                               / res_full["series"][m][tov].sum()),
            "corr": float(np.corrcoef(res_terra["series"][m][tov], res_full["series"][m][tov])[0, 1])}
        for m in ("B0", "B1", "M1")}

    # transfer check S-NPP vs NOAA-20 -------------------------------------------------
    tn = np.arange(T_N20, T_OVE)
    rn = reg["S-NPP"][tn] / reg["NOAA-20"][tn]
    M["snpp_vs_noaa20"] = {
        "period": [MONTH_LABEL[T_N20], MONTH_LABEL[T_OVE - 1]], "n_months": int(len(tn)),
        "sum_ratio_snpp_over_noaa20": float(reg["S-NPP"][tn].sum() / reg["NOAA-20"][tn].sum()),
        "monthly_ratio_min": float(rn.min()), "monthly_ratio_median": float(np.median(rn)),
        "monthly_ratio_max": float(rn.max()),
        "pearson_r": float(np.corrcoef(reg["S-NPP"][tn], reg["NOAA-20"][tn])[0, 1]),
        "pearson_r_log": float(np.corrcoef(np.log(reg["S-NPP"][tn]), np.log(reg["NOAA-20"][tn]))[0, 1]),
        "noaa20_first_detection": str(pts.loc[pts["satellite"] == "NOAA-20", "acq_datetime_utc"].min()),
    }
    print("S-NPP vs NOAA-20:", M["snpp_vs_noaa20"], flush=True)

    # sensitivity: all types ------------------------------------------------------------
    if not args.skip_sensitivity:
        print("sensitivity rerun with all types ...", flush=True)
        prep_all = prepare(pts_all, g)
        ca = prep_all["cubes"]
        cells_all = (ca["MODIS"][ov] + ca["S-NPP"][ov] + ca["NOAA-20"][ov]).sum(axis=0) > 0
        res_all = loyo(prep_all, "full", cells_all, ca["MODIS"][ov].sum(axis=0) > 0)
        M["sensitivity_all_types"] = strip(res_all)
        M["sensitivity_all_types"]["chosen"] = choose(res_all["summary"])
        print(pd.DataFrame(res_all["summary"]).T[["mean_mae", "mean_bias", "mean_r2", "pooled_r2",
              "mean_poisson_deviance", "mean_median_agreement"]].round(3).to_string())
        del prep_all, res_all

    # final models: train on the whole overlap, predict 2000-11 .. 2012-01 --------------
    print("final fit and back-prediction ...", flush=True)
    clip_final = len(CLIP_LOG)
    harm = reg["S-NPP"].copy()
    lower = harm.copy()
    upper = harm.copy()
    source = np.array(["observed_viirs"] * T, dtype=object)
    cell_harm = cubes["S-NPP"].astype(np.float32).copy()
    alt = {}
    for variant, method, t_pred, res in (
            ("terra", chosen_terra, np.arange(0, T_AQUA), res_terra),
            ("full", chosen_full, np.arange(T_AQUA, T_OV0), res_full)):
        Xtr, _, ttr, btr = panel(prep, variant, tov, train_cells)
        ytr = cubes["S-NPP"][tov][:, train_cells].ravel().astype(np.float64)
        for label, cells in (("modis_cells", pred_cells), ("union_cells", pred_cells | train_cells)):
            Xp, _, tp, bp = panel(prep, variant, t_pred, cells)
            p = fit_predict(method, Xtr, ytr, btr, ttr, Xp, bp, tp)
            alt.setdefault(label, np.zeros(T))[t_pred] = region_series(p, tp)[t_pred]
            if label == "modis_cells":
                s = res["summary"][method]
                harm[t_pred] = region_series(p, tp)[t_pred]
                lower[t_pred] = np.maximum((harm[t_pred] + 1) * np.exp(s["logratio_q05"]) - 1, 0)
                upper[t_pred] = (harm[t_pred] + 1) * np.exp(s["logratio_q95"]) - 1
                source[t_pred] = "modeled_from_modis"
                block = np.zeros((len(t_pred), g.H, g.W), dtype=np.float32)
                block[:, cells] = p.reshape(len(t_pred), -1)
                cell_harm[t_pred] = block
        if variant == "full":
            # what would the Terra-only model say for the first 24 Terra+Aqua months?
            t24 = np.arange(T_AQUA, T_AQUA + 24)
            Xt, _, ttr_t, btr_t = panel(prep, "terra", tov, train_cells)
            Xq, _, tq, bq = panel(prep, "terra", t24, pred_cells)
            pt = region_series(fit_predict(chosen_terra, Xt, ytr, btr_t, ttr_t, Xq, bq, tq), tq)
            M["step_2002"] = {
                "months_after": [MONTH_LABEL[t24[0]], MONTH_LABEL[t24[-1]]],
                "raw_terra_over_modis_after": float(reg["Terra"][t24].sum() / reg["MODIS"][t24].sum()),
                "terra_model_over_full_model_after": float(pt[t24].sum() / harm[t24].sum()),
            }
    tb = np.arange(T_AQUA - 12, T_AQUA)
    ta = np.arange(T_AQUA, T_AQUA + 12)
    M["step_2002"].update({
        "window_before": [MONTH_LABEL[tb[0]], MONTH_LABEL[tb[-1]]],
        "window_after": [MONTH_LABEL[ta[0]], MONTH_LABEL[ta[-1]]],
        "raw_modis_after_over_before": float(reg["MODIS"][ta].sum() / reg["MODIS"][tb].sum()),
        "raw_terra_after_over_before": float(reg["Terra"][ta].sum() / reg["Terra"][tb].sum()),
        "harmonized_after_over_before": float(harm[ta].sum() / harm[tb].sum()),
        "aqua_first_detection": str(pts.loc[pts["satellite"] == "Aqua", "acq_datetime_utc"].min()),
        "aqua_detections_before_2002_07": int(reg["Aqua"][:T_AQUA].sum()),
        "terra_first_detection": str(pts.loc[pts["satellite"] == "Terra", "acq_datetime_utc"].min()),
    })
    tm = np.arange(0, T_OV0)
    M["range_guard_final"] = clip_stats(clip_final)
    M["max_cell_value_modeled_period"] = float(cell_harm[:T_OV0].max())
    M["pred_panel_check"] = {
        "modeled_total_modis_cells": float(alt["modis_cells"][tm].sum()),
        "modeled_total_union_cells": float(alt["union_cells"][tm].sum()),
        "union_over_modis_cells": float(alt["union_cells"][tm].sum() / alt["modis_cells"][tm].sum()),
    }
    print("step 2002:", M["step_2002"], "\npred panel:", M["pred_panel_check"], flush=True)

    # days without any Terra detection in the Terra-only period (possible data gaps)
    terra_days = pts.loc[(pts["satellite"] == "Terra") & (pts["t"] < T_AQUA),
                         "acq_datetime_utc"].dt.normalize().unique()
    all_days = pd.date_range(f"{Y0}-{M0:02d}-01", "2002-06-30", freq="D")
    missing = all_days.difference(pd.DatetimeIndex(terra_days))
    runs, start, prev = [], None, None
    for day in missing:
        if prev is None or (day - prev).days != 1:
            if start is not None:
                runs.append((start, prev))
            start = day
        prev = day
    if start is not None:
        runs.append((start, prev))
    M["terra_only_period_gaps"] = {
        "days_total": int(len(all_days)), "days_without_terra_detection": int(len(missing)),
        "runs_of_5_or_more_days": [[str(a.date()), str(b.date()), int((b - a).days + 1)]
                                   for a, b in runs if (b - a).days + 1 >= 5]}
    print("Terra-only period gaps:", M["terra_only_period_gaps"], flush=True)

    # outputs ---------------------------------------------------------------------------
    monthly = pd.DataFrame({
        "month": MONTH_LABEL,
        "modis_count": reg["MODIS"].astype(int),
        "snpp_count": pd.array(np.where(np.arange(T) >= mi(2012, 1), reg["S-NPP"], np.nan)).astype("Int64"),
        "noaa20_count": pd.array(np.where(np.arange(T) >= T_N20, reg["NOAA-20"], np.nan)).astype("Int64"),
        "harmonized_viirs_eq": np.round(harm, 1),
        "lower": np.round(lower, 1),
        "upper": np.round(upper, 1),
        "source": source,
    })
    monthly.to_csv(out / f"{key}_monthly.csv", index=False)
    M["monthly_csv"] = {"rows": int(len(monthly)),
                        "rows_modeled": int((source == "modeled_from_modis").sum()),
                        "rows_observed": int((source == "observed_viirs").sum())}

    loyo_pred = pd.DataFrame({"month": MONTH_LABEL[tov], "snpp_observed": res_full["obs"][tov].astype(int),
                              "noaa20_observed": np.where(tov >= T_N20, reg["NOAA-20"][tov], np.nan)})
    for res in (res_full, res_terra):
        for m in ("B0", "B1", "M1"):
            loyo_pred[f"{res['variant']}_{m}"] = np.round(res["series"][m][tov], 1)
    loyo_pred.to_csv(out / f"{key}_loyo_predictions.csv", index=False)

    # cell-month table: modeled months dense over the prediction panel, observed months sparse
    any_cells = pred_cells | train_cells
    iy, ix = np.nonzero(any_cells)
    frames = []
    for t in range(T):
        modeled = source[t] == "modeled_from_modis"
        keep = pred_cells[iy, ix] if modeled else (
            (cubes["MODIS"][t, iy, ix] + cubes["S-NPP"][t, iy, ix] + cubes["NOAA-20"][t, iy, ix]) > 0)
        if not modeled:
            pass
        else:
            keep = keep | (cubes["MODIS"][t, iy, ix] > 0)
        yy, xx = iy[keep], ix[keep]
        frames.append(pd.DataFrame({
            "month": MONTH_LABEL[t], "cell_lat": g.lat_c[yy].astype(np.float32),
            "cell_lon": g.lon_c[xx].astype(np.float32),
            "terra_count": cubes["Terra"][t, yy, xx].astype(np.int32),
            "aqua_count": cubes["Aqua"][t, yy, xx].astype(np.int32),
            "snpp_count": cubes["S-NPP"][t, yy, xx].astype(np.int32),
            "noaa20_count": cubes["NOAA-20"][t, yy, xx].astype(np.int32),
            "harmonized_viirs_eq": np.round(cell_harm[t, yy, xx], 3).astype(np.float32),
            "source": source[t]}))
    cell = pd.concat(frames, ignore_index=True)
    cell["month"] = cell["month"].astype("category")
    cell["source"] = cell["source"].astype("category")
    cp = out / f"{key}_cell_month.parquet"
    cell.to_parquet(cp, compression="zstd", compression_level=19, index=False)
    size_mb = cp.stat().st_size / 1e6
    M["cell_month_parquet"] = {"rows": int(len(cell)), "size_mb": round(size_mb, 2),
                               "written": bool(size_mb < 20)}
    if size_mb >= 20:
        cp.unlink()
        print(f"cell-month parquet is {size_mb:.1f} MB (>= 20 MB): not kept", flush=True)
    else:
        print(f"cell-month parquet: {len(cell)} rows, {size_mb:.2f} MB", flush=True)

    fig_raw(region, reg["MODIS"], reg["S-NPP"], reg["NOAA-20"], figs / f"{key}_raw_monthly_series.png")
    fig_heldout(region, res_full, chosen_full, figs / f"{key}_heldout_harmonized_vs_observed.png")
    fig_calendar(region, monthly, figs / f"{key}_calendar_heatmap.png")
    fig_step(region, reg["Terra"], reg["MODIS"], monthly, figs / f"{key}_step_2002.png")

    (out / f"{key}_metrics.json").write_text(json.dumps(to_native(M), indent=1))
    print("done.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
