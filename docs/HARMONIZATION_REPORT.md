# Harmonization report: MODIS to VIIRS-equivalent hotspot counts (test region Argentina)

NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".
Every number in this report was produced by the scripts in `scripts/` on 2026-11-14 and is
stored in `data/harmonized/argentina_metrics.json`, `data/harmonized/argentina_loyo_metrics.csv`
or `data/processed/argentina/build_summary.json` (the last one is rebuilt by `build_dataset.py`).

## 1. Result in short

- Raw monthly counts are not comparable: in the overlap period 2012-02 to 2025-12, VIIRS S-NPP
  reports 3.47 times as many vegetation-fire hotspots as MODIS (Terra + Aqua). The monthly
  ratio ranges from 1.91 to 5.60, and from 3.07 (August) to 4.09 (February) by calendar month.
- Three methods translate MODIS into VIIRS-equivalent counts. All three were validated
  leave-one-year-out over 2012 to 2025 (14 folds, no random row splits):

| Method | Region-month MAE | Bias | R² (mean of years) | Cell-month Poisson deviance | Agreement "above/below median" |
|---|---|---|---|---|---|
| B0, one constant factor | 1,995 | -16 | 0.933 | 4.62 | 92.7 % |
| B1, one factor per calendar month | 1,544 | -45 | 0.969 | 4.61 | 92.7 % |
| M1, gradient boosting (Poisson) | 1,114 | -56 | 0.982 | 1.91 | 92.9 % |

- **Chosen method: M1.** It has the lowest region-month error (28 % lower MAE than B1,
  44 % lower than B0) and by far the best cell-level fit.
- **Plain statement on the use-case metric:** for the calendar question "is this month above
  or below the multi-year median of its calendar month", M1 is not better than the baselines
  (92.9 % against 92.7 %, a difference of less than one month out of 167). A constant factor
  does not change which months lie above their own median, so raw MODIS already answers this
  question equally well. M1 pays off in the magnitudes (counts, anomalies in percent), at cell
  level (user-drawn areas), and when modeled and observed months are mixed in one series.
- The Terra-only period (2000-11 to 2002-06) is much less certain: MAE 2,004 and
  R² 0.946 for the Terra-only M1, with a 90 % interval of -34 % / +33 % instead of -22 % / +14 %.

Mean monthly S-NPP count in the overlap period for scale: 16,733 hotspots (2,794,390 in 167 months).

## 2. Data used

Source: FIRMS country yearly summary archive (science quality, no key required),
`https://firms.modaps.eosdis.nasa.gov/data/country/{inst}/{year}/{inst}_{year}_Argentina.csv`.

- 48 files, 510,628,826 bytes: MODIS 2000 to 2025 (26 files), VIIRS S-NPP 2012 to 2025 (14),
  VIIRS NOAA-20 2018 to 2025 (8). Every file size was verified against the official index
  `yearly_summary_files.txt`.
- 6,330,305 detections in the raw CSV files, 6,330,305 in the unified dataset (no row lost;
  the row count of every file is checked against an independent line count of the CSV).
- VIIRS low-confidence night-time detections (South Atlantic Anomaly artefacts): **0 found**
  in all 22 VIIRS files, so nothing had to be excluded.
- The unified dataset is 133.1 MB of Parquet (zstd), partitioned as
  `data/processed/argentina/sensor=.../year=.../{satellite}.parquet`. It is not committed;
  it is rebuilt by two commands (see README).

Rows per satellite and year:

| Year | Terra | Aqua | S-NPP | NOAA-20 |
|---|---|---|---|---|
| 2000 | 7,247 | – | – | – |
| 2001 | 31,835 | – | – | – |
| 2002 | 26,681 | 33,680 | – | – |
| 2003 | 40,610 | 76,480 | – | – |
| 2004 | 36,097 | 63,859 | – | – |
| 2005 | 27,132 | 44,047 | – | – |
| 2006 | 30,739 | 53,907 | – | – |
| 2007 | 27,528 | 50,537 | – | – |
| 2008 | 37,080 | 67,619 | – | – |
| 2009 | 29,875 | 52,137 | – | – |
| 2010 | 23,747 | 38,962 | – | – |
| 2011 | 28,940 | 47,489 | – | – |
| 2012 | 22,643 | 39,240 | 189,787 | – |
| 2013 | 24,923 | 41,626 | 237,553 | – |
| 2014 | 14,853 | 21,963 | 126,346 | – |
| 2015 | 16,411 | 28,722 | 151,071 | – |
| 2016 | 19,522 | 35,880 | 181,421 | – |
| 2017 | 22,864 | 37,416 | 201,664 | – |
| 2018 | 20,300 | 35,099 | 184,924 | 130,089 |
| 2019 | 18,305 | 32,065 | 161,688 | 160,664 |
| 2020 | 43,268 | 80,826 | 448,313 | 434,775 |
| 2021 | 20,721 | 36,146 | 198,060 | 198,976 |
| 2022 | 27,892 | 49,629 | 312,925 | 312,448 |
| 2023 | 18,445 | 29,465 | 171,695 | 163,741 |
| 2024 | 16,267 | 33,576 | 152,971 | 157,781 |
| 2025 | 14,787 | 33,334 | 170,674 | 170,323 |
| **Total** | **648,712** | **1,063,704** | **2,889,092** | **1,728,797** |

Shares per satellite (all years):

| Satellite | type 0 vegetation fire | type 1 volcano | type 2 static land source | type 3 offshore | Night share | low / nominal / high confidence |
|---|---|---|---|---|---|---|
| Terra | 97.117 % | 1 row | 2.874 % | 0.008 % | 24.63 % | 37,350 / 419,918 / 191,444 |
| Aqua | 98.749 % | 3 rows | 1.250 % | 0.001 % | 7.55 % | 44,482 / 687,712 / 331,510 |
| S-NPP | 96.927 % | 0 rows | 2.794 % | 0.279 % | 26.71 % | 252,260 / 2,408,524 / 228,308 |
| NOAA-20 | 96.808 % | 0 rows | 2.841 % | 0.351 % | 26.09 % | 160,181 / 1,446,771 / 121,845 |

Product versions found in the `version` column: MODIS `6.2` (files 2000 to 2017), `6.03`
(2018 to 2022) and `61.03` (2023 to 2025); VIIRS `2` (all files).

### Unified schema

| Column | Content |
|---|---|
| `latitude`, `longitude` | degrees, as delivered |
| `acq_datetime_utc` | `acq_date` + `acq_time` (zero-padded to HHMM, UTC) |
| `sensor` | `MODIS` or `VIIRS` (partition key in the path) |
| `satellite` | `Terra`, `Aqua`, `S-NPP`, `NOAA-20` (archive codes `Terra`, `Aqua`, `N`, `N20`) |
| `confidence_raw` | original value: MODIS 0 to 100, VIIRS `l` / `n` / `h` |
| `confidence_class` | `low`, `nominal`, `high` |
| `frp` | fire radiative power, MW |
| `daynight` | `D` or `N` |
| `version` | collection and processing version as delivered |
| `type` | 0 vegetation fire, 1 volcano, 2 static land source, 3 offshore |
| `bt_mir` | MODIS `brightness` / VIIRS `bright_ti4`, Kelvin |
| `bt_tir` | MODIS `bright_t31` / VIIRS `bright_ti5`, Kelvin |
| `scan`, `track` | pixel size along scan and along track |

MODIS confidence classes follow Table 11 (section 8.4.3, page 51) of the *MODIS Collection 6
and Collection 6.1 Active Fire Product User's Guide*, version 1.0: 0 % <= C < 30 % low,
30 % <= C < 80 % nominal, 80 % <= C <= 100 % high.
https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf

### Check against values measured before this experiment (Argentina 2020, type 0)

| Quantity | Measured before | This run |
|---|---|---|
| S-NPP / MODIS, monthly ratio | 3.40 to 4.30 | 3.40 to 4.30 |
| S-NPP / Aqua, monthly ratio | 4.5 to 9.1 | 4.51 to 9.13 |
| Night share MODIS / S-NPP | 13 % / 23 % | 13.1 % / 23.2 % |

## 3. Methods and validation design

- Grid 0.25 degrees, time unit calendar month (UTC). The grid covering all detections has
  133 x 79 cells; the record has 302 months (2000-11 to 2025-12).
- Main run: `type == 0` (6,154,332 detections). Sensitivity run: all types.
- **Target:** S-NPP count per cell-month. **Overlap period:** 2012-02 to 2025-12 (167 months).
  January 2012 is treated as modeled because S-NPP data starts on 2012-01-20.
- **Training panel:** 4,199 cells with at least one detection by any sensor in the overlap
  period x 167 months = 701,233 rows. Missing combinations are zeros and are kept; 75.0 % of the
  rows have an S-NPP count of zero. 7.9 % of all S-NPP detections fall into cell-months in
  which MODIS detected nothing, which is why zeros must not be dropped.
- **Prediction panel for 2000-11 to 2012-01:** 3,630 cells with at least one MODIS detection in
  that period. Using the union with the training panel instead would change the modeled total
  by +0.18 %, so the simpler definition was kept.
- **B0:** one factor k = sum(S-NPP) / sum(MODIS), from the training years only.
- **B1:** one such factor per calendar month.
- **M1:** scikit-learn `HistGradientBoostingRegressor(loss="poisson")` with fixed
  hyperparameters (learning rate 0.05, 400 iterations, 31 leaves, at least 40 samples per leaf,
  L2 1.0, no early stopping). The hyperparameters were set once and not tuned on the
  validation folds. Features, all derived from MODIS only (20 in the Terra+Aqua variant):
  Terra count, Aqua count, total count, day count, night count, summed / mean / maximum FRP,
  mean scan size, counts per confidence class, detections in the 8 neighbouring cells in the
  same month, count in the same cell in the previous and in the next month, the cell's MODIS
  climatology for that calendar month, the cell's overall MODIS mean, calendar month, cell
  latitude and longitude. No feature uses VIIRS.
- **Range guard for M1:** a cell prediction is capped at the largest target value seen in the
  training data of that fit. Reason: see section 6.
- **Region-month value** = sum of the cell predictions of that month.
- **Validation:** leave-one-year-out over 2012 to 2025. Each year is predicted by a model that
  has never seen any row of that year. 2012 has 11 months, all other years 12.
- **Metrics per held-out year:** region-month MAE, bias (prediction minus observation) and R²
  over the months of that year; mean Poisson deviance over the cell-months of that year; share
  of months in which the harmonized series and the real S-NPP series agree on "above/below the
  multi-year median of that calendar month". Each series is compared with its own median over
  2012 to 2025, the way the calendar would do it. A second variant compares the harmonized value
  with the median of the real S-NPP series.
- B0 and B1 predict exactly zero wherever MODIS saw nothing, which makes the Poisson deviance
  infinite. Predictions are therefore floored at 0.01 inside the deviance. The value of B0 and B1
  depends on this floor; M1 never predicts zero.
- **Interval (`lower`, `upper`):** 5 % and 95 % quantiles of log((observed + 1) / (predicted + 1))
  over the 167 out-of-sample region-months, applied multiplicatively. This is a 90 % interval for
  the country total. It is not valid for smaller areas.
- **Final models** are trained on the whole overlap period and applied to 2000-11 to 2012-01.

## 4. Results

### 4.1 Terra+Aqua models (used for 2002-07 to 2012-01), mean over 14 held-out years

| Method | MAE | Bias | Rel. bias % | R² (mean of years) | R² (pooled) | Poisson deviance | Median agreement | Agreement vs S-NPP median |
|---|---|---|---|---|---|---|---|---|
| B0 | 1,995 | -16 | +1.6 | 0.933 | 0.958 | 4.62 | 92.7 % | 87.9 % |
| B1 | 1,544 | -45 | +1.5 | 0.969 | 0.973 | 4.61 | 92.7 % | 89.7 % |
| M1 | 1,114 | -56 | +0.4 | 0.982 | 0.988 | 1.91 | 92.9 % | 89.8 % |

Pooled over all 167 held-out months, M1 reaches MAE 1,117, relative bias -0.3 % and R² 0.988.

Per held-out year (MAE, bias and R² at region-month level, deviance at cell-month level,
agreement = share of months on the same side of the median):

| Year | MAE B0 | MAE B1 | MAE M1 | Bias B0 | Bias B1 | Bias M1 | R² B0 | R² B1 | R² M1 | Dev. B0 | Dev. B1 | Dev. M1 | Agree B0 | Agree B1 | Agree M1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2012 | 1,414 | 1,392 | 663 | +1,264 | +1,008 | +102 | 0.955 | 0.978 | 0.992 | 4.24 | 4.26 | 1.72 | 82 % | 82 % | 100 % |
| 2013 | 1,879 | 1,803 | 958 | -111 | -437 | -563 | 0.978 | 0.976 | 0.995 | 4.95 | 4.98 | 1.93 | 100 % | 100 % | 92 % |
| 2014 | 837 | 850 | 663 | +475 | +725 | +283 | 0.969 | 0.982 | 0.989 | 3.80 | 3.83 | 1.54 | 100 % | 100 % | 92 % |
| 2015 | 1,154 | 1,267 | 1,146 | +779 | +726 | -69 | 0.974 | 0.965 | 0.976 | 4.04 | 4.09 | 1.65 | 83 % | 83 % | 92 % |
| 2016 | 2,016 | 1,333 | 670 | +1,193 | +941 | +98 | 0.949 | 0.987 | 0.997 | 4.18 | 4.17 | 1.66 | 83 % | 83 % | 83 % |
| 2017 | 1,786 | 1,333 | 660 | +999 | +1,278 | +215 | 0.932 | 0.979 | 0.994 | 4.32 | 4.32 | 1.83 | 100 % | 100 % | 100 % |
| 2018 | 1,345 | 593 | 907 | +154 | +134 | -161 | 0.976 | 0.997 | 0.992 | 4.58 | 4.57 | 1.88 | 92 % | 92 % | 100 % |
| 2019 | 1,527 | 932 | 716 | +710 | +528 | -110 | 0.967 | 0.990 | 0.995 | 4.46 | 4.46 | 1.79 | 92 % | 92 % | 75 % |
| 2020 | 2,288 | 3,365 | 1,597 | -2,151 | -2,926 | -522 | 0.987 | 0.969 | 0.996 | 5.81 | 5.86 | 2.68 | 100 % | 100 % | 100 % |
| 2021 | 1,702 | 855 | 695 | -123 | -436 | -188 | 0.956 | 0.990 | 0.994 | 4.77 | 4.74 | 1.87 | 100 % | 100 % | 100 % |
| 2022 | 5,228 | 3,579 | 2,946 | -3,972 | -2,999 | -1,931 | 0.849 | 0.917 | 0.952 | 5.83 | 5.68 | 2.41 | 100 % | 100 % | 83 % |
| 2023 | 1,885 | 1,189 | 982 | -459 | -217 | +2 | 0.874 | 0.958 | 0.976 | 4.51 | 4.47 | 1.79 | 92 % | 92 % | 92 % |
| 2024 | 2,532 | 1,694 | 1,780 | +1,492 | +1,225 | +1,536 | 0.903 | 0.956 | 0.948 | 4.20 | 4.15 | 1.87 | 92 % | 92 % | 92 % |
| 2025 | 2,329 | 1,432 | 1,212 | -470 | -180 | +525 | 0.792 | 0.923 | 0.953 | 5.03 | 4.97 | 2.08 | 83 % | 83 % | 100 % |
| **Mean** | **1,995** | **1,544** | **1,114** | **-16** | **-45** | **-56** | **0.933** | **0.969** | **0.982** | **4.62** | **4.61** | **1.91** | **92.7 %** | **92.7 %** | **92.9 %** |

M1 has the lowest MAE in 12 of 14 years. B1 is better in 2018 and 2024.

### 4.2 Terra-only models (used for 2000-11 to 2002-06)

| Method | MAE | Bias | Rel. bias % | R² (mean of years) | R² (pooled) | Poisson deviance | Median agreement | Agreement vs S-NPP median |
|---|---|---|---|---|---|---|---|---|
| B0 | 3,029 | -15 | +1.8 | 0.885 | 0.939 | 12.48 | 88.0 % | 80.8 % |
| B1 | 2,449 | -17 | +1.5 | 0.914 | 0.950 | 12.51 | 85.6 % | 81.4 % |
| M1 | 2,004 | -45 | +1.7 | 0.946 | 0.967 | 3.44 | 86.8 % | 83.8 % |

| Year | MAE B0 | MAE B1 | MAE M1 | Bias B0 | Bias B1 | Bias M1 | R² B0 | R² B1 | R² M1 | Dev. B0 | Dev. B1 | Dev. M1 | Agree B0 | Agree B1 | Agree M1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2012 | 2,990 | 2,244 | 1,499 | +1,196 | +2,201 | +873 | 0.898 | 0.935 | 0.972 | 12.87 | 13.01 | 3.02 | 82 % | 82 % | 82 % |
| 2013 | 2,455 | 1,993 | 859 | +1,044 | +1,207 | +328 | 0.976 | 0.985 | 0.997 | 13.38 | 13.49 | 3.80 | 100 % | 100 % | 83 % |
| 2014 | 2,408 | 1,495 | 1,783 | +1,937 | +1,470 | +1,728 | 0.869 | 0.942 | 0.907 | 8.91 | 8.84 | 2.64 | 100 % | 92 % | 92 % |
| 2015 | 4,060 | 2,862 | 2,559 | +1,079 | +1,128 | +1,022 | 0.665 | 0.828 | 0.875 | 11.74 | 11.65 | 3.03 | 75 % | 75 % | 83 % |
| 2016 | 3,070 | 2,353 | 1,269 | +1,083 | +527 | -34 | 0.944 | 0.965 | 0.991 | 11.41 | 11.35 | 3.20 | 83 % | 83 % | 75 % |
| 2017 | 3,812 | 2,186 | 1,810 | +2,352 | +2,127 | +674 | 0.841 | 0.939 | 0.966 | 11.79 | 11.73 | 3.47 | 92 % | 92 % | 92 % |
| 2018 | 2,709 | 1,747 | 2,516 | +245 | +240 | +569 | 0.927 | 0.966 | 0.916 | 12.24 | 12.24 | 3.46 | 83 % | 83 % | 92 % |
| 2019 | 2,674 | 1,583 | 1,020 | +631 | +371 | +297 | 0.935 | 0.976 | 0.990 | 11.54 | 11.50 | 3.01 | 83 % | 75 % | 83 % |
| 2020 | 5,043 | 2,841 | 3,631 | -3,147 | -1,735 | -3,096 | 0.958 | 0.986 | 0.981 | 16.70 | 16.65 | 5.06 | 100 % | 100 % | 100 % |
| 2021 | 2,189 | 1,628 | 1,951 | -73 | +299 | +397 | 0.948 | 0.962 | 0.962 | 12.12 | 12.19 | 3.17 | 100 % | 92 % | 92 % |
| 2022 | 4,136 | 6,411 | 4,773 | -3,933 | -5,209 | -3,413 | 0.906 | 0.784 | 0.887 | 15.13 | 15.50 | 4.60 | 75 % | 75 % | 75 % |
| 2023 | 1,793 | 1,934 | 1,379 | +417 | +406 | +1,000 | 0.936 | 0.917 | 0.953 | 11.02 | 11.10 | 3.21 | 83 % | 83 % | 92 % |
| 2024 | 1,749 | 1,604 | 1,170 | -147 | -16 | +637 | 0.958 | 0.962 | 0.982 | 11.29 | 11.38 | 2.84 | 100 % | 100 % | 92 % |
| 2025 | 3,322 | 3,397 | 1,834 | -2,898 | -3,252 | -1,612 | 0.627 | 0.643 | 0.861 | 14.59 | 14.58 | 3.58 | 75 % | 67 % | 83 % |
| **Mean** | **3,029** | **2,449** | **2,004** | **-15** | **-17** | **-45** | **0.885** | **0.914** | **0.946** | **12.48** | **12.51** | **3.44** | **88.0 %** | **85.6 %** | **86.8 %** |

M1 has the lowest mean MAE and is used, but it is worse than B1 in 4 of 14 years (2014, 2018,
2020 and 2021), and on
the use-case metric the plain constant factor B0 is the best of the three (88.0 %).
The Terra-only baselines show a drift over the years: B1 is 13.6 % too high in 2012 and 23.8 %
too low in 2025. The Terra to S-NPP relation is therefore not stable in time, which adds
uncertainty when it is transferred back to 2000 to 2002.

### 4.3 The 2002 step

Aqua's first detection in the archive is on 2002-07-04; there are 0 Aqua detections before
2002-07. Comparing the 12 months after the start of Aqua (2002-07 to 2003-06) with the 12
months before (2001-07 to 2002-06):

| Series | After / before |
|---|---|
| Raw MODIS total | 2.55 |
| Raw Terra only (same sensor on both sides, reference) | 0.88 |
| Harmonized VIIRS-equivalent | 0.91 |

The artificial jump by a factor of 2.55 disappears; the harmonized series changes by the same
amount as the one sensor that observed both periods. A second check: for 2002-07 to 2004-06 the
Terra-only model yields 0.908 times the total of the Terra+Aqua model (inside the overlap
period the two agree to 1.000 with a correlation of 0.989). The Terra-only months may therefore
be about 9 % low relative to the months after them. See `docs/figures/argentina_step_2002.png`.

### 4.4 Transfer check: S-NPP against NOAA-20 (2018-04 to 2025-12, 93 months)

- Sum ratio S-NPP / NOAA-20: 1.013. Monthly ratio: median 1.008, range 0.60 to 1.33.
- Pearson correlation of the monthly counts: 0.997 (0.995 on the log scale).
- The lowest ratios are 2024-07 (S-NPP 9,514 against NOAA-20 15,904) and 2022-07 (9,079
  against 12,658). In these months S-NPP reports far fewer hotspots than its twin sensor.

The same out-of-sample predictions, evaluated against NOAA-20 instead of S-NPP:

| Variant | Method | MAE | Bias | Rel. bias % | R² | Median agreement |
|---|---|---|---|---|---|---|
| Terra+Aqua | B0 | 2,220 | -322 | -1.8 | 0.962 | 93.5 % |
| Terra+Aqua | B1 | 1,544 | -407 | -2.3 | 0.977 | 93.5 % |
| Terra+Aqua | M1 | 1,276 | +120 | +0.7 | 0.988 | 93.5 % |
| Terra-only | B0 | 2,971 | -1,021 | -5.7 | 0.945 | 91.4 % |
| Terra-only | B1 | 2,554 | -971 | -5.4 | 0.951 | 89.2 % |
| Terra-only | M1 | 2,203 | -551 | -3.1 | 0.968 | 89.2 % |

A calendar harmonized to S-NPP therefore carries over to NOAA-20 without a second
correction: M1 is within +0.7 % of the NOAA-20 total.

### 4.5 Sensitivity: all types instead of type 0

4,201 cells, same design, Terra+Aqua variant:

| Method | MAE | Bias | Rel. bias % | R² (mean of years) | R² (pooled) | Poisson deviance | Median agreement | Agreement vs S-NPP median |
|---|---|---|---|---|---|---|---|---|
| B0 | 1,973 | -15 | +1.4 | 0.936 | 0.959 | 5.19 | 94.0 % | 87.9 % |
| B1 | 1,590 | -45 | +1.3 | 0.968 | 0.972 | 5.19 | 91.5 % | 89.1 % |
| M1 | 1,186 | -57 | +0.5 | 0.979 | 0.987 | 1.98 | 91.7 % | 89.2 % |

The ranking by MAE is unchanged (M1 < B1 < B0). With static sources included, B0 has the
highest median agreement (94.0 %), M1 91.7 %.

## 5. Outputs

- `data/harmonized/argentina_monthly.csv`: 302 months. Columns `month`, `modis_count`,
  `snpp_count`, `noaa20_count`, `harmonized_viirs_eq`, `lower`, `upper`, `source`.
  135 months are `modeled_from_modis` (2000-11 to 2012-01), 167 are `observed_viirs`
  (S-NPP count; `lower` = `upper` = observed value). Counts are type 0 only.
- `data/harmonized/argentina_cell_month.parquet`: 699,099 rows, 1.93 MB. Modeled months contain
  all prediction-panel cells, observed months only cells with at least one detection.
- `data/harmonized/argentina_loyo_metrics.csv`: metrics per method, variant and held-out year.
- `data/harmonized/argentina_loyo_predictions.csv`: out-of-sample region-month predictions.
- `data/harmonized/argentina_metrics.json`: all remaining numbers of this report.
- `docs/figures/argentina_raw_monthly_series.png`: raw MODIS and VIIRS monthly series.
- `docs/figures/argentina_heldout_harmonized_vs_observed.png`: harmonized against observed in
  held-out years.
- `docs/figures/argentina_calendar_heatmap.png`: calendar heatmap, years x months, cividis.
- `docs/figures/argentina_step_2002.png`: the 2002 step before and after harmonization.

## 6. What failed

- **M1 without a range guard failed in the first run.** In the Terra-only variant, the fold
  with 2018 held out predicted 353,020 hotspots for a single cell-month in which S-NPP observed
  351. That one value pushed the predicted country total for January 2018 to 381,351 against
  24,110 observed, the MAE of the 2018 fold to 31,488 (R² -56.7) and the mean MAE of the
  Terra-only M1 to 4,073 (mean R² -3.17), worse than both baselines. Cause: with a log link the
  boosted trees add up on the log scale, and a rare feature combination can produce an absurd
  value. After this was found, the cap described in section 3 was added and the complete
  experiment was run again. The cap was added after seeing a validation result; it only uses
  training data, but it is a post-hoc change and is disclosed here. With the cap, 1 of the
  cell predictions in the 14 Terra-only folds, 0 in the 14 Terra+Aqua folds and 2 in the final
  back-prediction were clipped. The Terra+Aqua results are identical in both runs.
- The cap is a blunt tool: in the fold with 2022 held out the cap is 2,966, while the largest
  real cell-month value in 2022 is 5,350. A model with this guard cannot reproduce a cell value
  above anything it was trained on.
- The download needed two passes. One file (`viirs-snpp_2012_Argentina.csv`) failed 8 attempts
  in a row with connection resets and succeeded on the second run of the script.
- M1 does not improve the use-case metric (section 1).
- Not done: tuning of hyperparameters, LightGBM, a NOAA-20 target, a second test region.

## 7. Limitations

- **Missing satellite data is not zero fire.** The scripts count detections; they do not know
  when a sensor did not observe. In the Terra-only period, 59 of 607 days have no Terra
  detection in Argentina, including runs of 18 days (2001-06-16 to 2001-07-03), 9 days
  (2002-03-20 to 2002-03-28) and 5 days (2002-05-16 to 2002-05-20). Whether a run is an outage or
  a quiet period cannot be decided from the archive alone; FIRMS offers `/api/missing_data/`
  for this. Affected months are biased low. The same holds for the target: the low
  S-NPP / NOAA-20 ratios in 2022-07 and 2024-07 (section 4.4) point to gaps in S-NPP, and those
  months enter both training and validation as if they were real.
- **Static sources.** The main result uses type 0 only. Types 1 to 3 are 1.3 % (Aqua) to
  3.2 % (NOAA-20) of the detections in Argentina. Other regions differ strongly, so this choice
  must be revisited per region. Near-real-time data has no `type` column; a filter applied to the
  archive must be applied to NRT data through a spatial mask.
- **Terra-only period.** Validated only indirectly: the Terra-only model was tested on 2012 to
  2025, not on 2000 to 2002. Its error is about 1.8 times that of the Terra+Aqua model, the Terra to
  S-NPP relation drifts over the overlap years, and section 4.3 indicates a level about 9 % low.
- **Stationarity.** The method assumes that the MODIS to VIIRS relation of 2012 to 2025 also held
  in 2000 to 2011. This cannot be tested with this data. The yearly S-NPP / MODIS ratio varies
  between 3.11 (2024) and 4.04 (2022) inside the overlap period.
- **Mixed MODIS versions** in the archive (`6.2`, `6.03`, `61.03`, see section 2).
- **One region.** All numbers are for Argentina. Nothing here shows that the factors or the
  model transfer to another country.
- **Intervals** come from 167 country-level residuals and are valid for the country total only.
  Measured against the same residuals they cover 89.2 % of the months, by construction.
- **The observed part of the calendar is S-NPP**, which ended on 2026-11-02. NOAA-20 agrees with
  it to 1.3 % in total, but single months differ by up to 40 %.

## 8. Next step

Extend the calendar to 2026 with the FIRMS API (`/api/area/csv/[MAP_KEY]/[SOURCE]/[bbox]/[1..5]/[date]`,
free MAP_KEY): science-quality data (`*_SP`) up to July or August 2026, near-real-time data
(`*_NRT`) after that. Because S-NPP ended on 2026-11-02, the observed series should switch to
NOAA-20 (and NOAA-21) for 2026; section 4.4 supports this switch for Argentina. Then repeat the
experiment for a second region before the method is offered for arbitrary user-drawn areas.

## 9. AI assistance

The code in `scripts/`, the analysis, the figures and this report were generated with Claude
(Anthropic) from the team's task description. The harmonization idea (learning VIIRS-equivalent
counts from MODIS with gradient boosting) is the team's. All numbers come from running the
committed scripts; none were estimated.

## 10. Acknowledgement and references

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource
Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere
Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and
NASA's Earth Science Data and Information System (ESDIS).

- Giglio, L., Schroeder, W., Justice, C.O. (2016): The collection 6 MODIS active fire detection
  algorithm and fire products. Remote Sensing of Environment 178: 31-41. doi:10.1016/j.rse.2016.02.054
- Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. (2014): The New VIIRS 375 m active fire
  detection data product. Remote Sensing of Environment 143: 85-96. doi:10.1016/j.rse.2013.12.008
- MODIS Collection 6 and Collection 6.1 Active Fire Product User's Guide, version 1.0 (link above).

## 11. Second region: Germany (bounding box, FIRMS API archive)

Added after the Argentina experiment to answer whether the approach transfers. Same scripts,
same validation design. Numbers are in `data/harmonized/germany_metrics.json`.

**Data.** A teammate's FIRMS API archive for the box 5.5 to 15.5 °E, 47 to 55.5 °N (Germany
plus border regions, not the country outline): 641 monthly files, 735,135 detections
from 2000-11 to 2026-11-14, science quality up to July or August 2026 and near-real-time after
that. Converted with `scripts/import_api_archive.py`. Near-real-time rows have no `type`;
26,239 such rows were typed by a rule (18,799 within about 1 km of a
known static source became type 2, the rest type 0). This is a derivation, not a NASA class.

| Satellite | Rows | type 0 share | NRT rows |
|---|---|---|---|
| Aqua | 38,768 | 29.1 % | 570 |
| NOAA-20 | 215,429 | 20.3 % | 8,670 |
| NOAA-21 | 85,484 | 22.4 % | 8,573 |
| S-NPP | 347,715 | 17.0 % | 7,849 |
| Terra | 47,739 | 18.5 % | 577 |

Only 142,027 of 734,233 detections are vegetation fires (type 0). The calendar
covers 2000-11 to 2026-10; November 2026 is incomplete and S-NPP ended on 2026-11-02.

**What is different from Argentina.** The mean monthly S-NPP count in the overlap period is
318 (Argentina: 16,733). S-NPP reports 4.33 times as many type 0 hot spots as MODIS.
80.3 % of all S-NPP detections fall into cell-months in which MODIS saw nothing
(Argentina: 7.9 %). MODIS therefore carries little information about what VIIRS sees here.

**Leave-one-year-out results, Terra+Aqua variant, type 0:**

| Method | MAE | Bias | R² (mean of years) | Poisson deviance | Median agreement |
|---|---|---|---|---|---|
| B0 | 179.1 | +2.8 | -0.096 | 2.35 | 76.7 % |
| B1 | 115.3 | +7.1 | 0.577 | 2.36 | 76.7 % |
| M1 | 87.4 | -0.2 | 0.750 | 0.77 | 55.7 % |

**Terra-only variant:**

| Method | MAE | Bias | R² (mean of years) | Poisson deviance | Median agreement |
|---|---|---|---|---|---|
| B0 | 178.3 | +4.2 | -0.014 | 2.60 | 71.3 % |
| B1 | 138.5 | +12.3 | 0.355 | 2.61 | 68.8 % |
| M1 | 93.9 | -0.1 | 0.718 | 0.80 | 49.7 % |

**Reading.** M1 has the lowest MAE and the highest R², but it agrees with S-NPP on "above or
below the median of the calendar month" in only 55.7 % of months, close to a coin
flip and far below the factor methods (76.7 %). It reproduces the seasonal cycle and
flattens the year-to-year differences, which are exactly what the calendar is for. The MAE
rule of section 1 would pick M1; **for Germany the calendar uses B1 instead**
(`--method B1`), and this deviation from the rule is deliberate. B1 itself is weak here:
MAE 115 on a mean of 318, R² 0.58. The 90 % interval of B1 spans a factor of
0.45 to 30.0, because months with zero MODIS detections are predicted as zero.
With all types instead of type 0, M1 reaches MAE 322 and B1 343, agreement 72.5 % and 78.5 %.

**S-NPP against NOAA-20** (2018-04 to 2025-12): sum ratio 0.907, monthly ratio 0.19 to
1.80, correlation 0.958. The two VIIRS sensors agree much less well than in Argentina
(1.013, correlation 0.997), so a switch to NOAA-20 needs its own correction here.

**2002 step:** raw MODIS after/before 4.03, Terra only 1.70, harmonized 1.37.
497 of 607 days in the Terra-only period have no Terra detection in the box, so
this comparison rests on very few detections.

**Conclusion on transfer.** The pipeline runs on a second region after two small generalizations
(`--end` for the last calendar month, `--method` to override the choice). The quality does
not transfer: where MODIS sees few fires, no method recovers the VIIRS record well, and the
gradient-boosting model is worse than a monthly factor for the calendar's purpose. The method
has to be chosen per region from the validation, and the use-case metric must be part of
that choice, not only the MAE.

**Web app.** The start page of `docs/` is the teammate's point map of this archive with the
harmonized calendar added (`calendar.js`).
