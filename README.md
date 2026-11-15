# WildFireCalander

NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots":
a harmonized burning-activity calendar (monthly hotspot counts from the early 2000s to
the present) for a user-selected area.

This repository currently contains the data pipeline and the harmonization experiment
for the test region Argentina:

- `scripts/fetch_firms.py`: resumable download of the keyless FIRMS yearly country archive
- `scripts/build_dataset.py`: one unified schema for MODIS and VIIRS (Parquet, zstd)
- `scripts/harmonize.py`: MODIS -> VIIRS-equivalent monthly counts, leave-one-year-out validation
- `docs/HARMONIZATION_REPORT.md`: data, methods, metrics, limitations
- `data/harmonized/`: the harmonized monthly calendar and the validation tables
- `docs/figures/`: figures used in the report
- `docs/`: the web site (fire map of Germany, calendar for Argentina)
- `scripts/build_app_data.py`: packs the harmonized data for the web app

## How to reproduce

Python 3.13, about 0.7 GB of free disk space. Install the pinned packages once with
`pip install -r requirements.txt`, then run three commands:

```bash
python scripts/fetch_firms.py --region Argentina
```

```bash
python scripts/build_dataset.py --region Argentina
```

```bash
python scripts/harmonize.py --region Argentina
```

1. `fetch_firms.py` downloads 48 CSV files (about 511 MB) to `data/raw/firms/`. The FIRMS
   server resets connections frequently; the script retries, resumes partial files and
   verifies every file size against the official index. Re-run it until it reports
   `48/48 files complete`.
2. `build_dataset.py` writes the unified dataset to `data/processed/argentina/` and checks
   that no row is lost.
3. `harmonize.py` runs the validation, writes `data/harmonized/` and `docs/figures/`.

`data/raw/` and `data/processed/` are not committed; they are rebuilt by steps 1 and 2.

## Web apps

`docs/` is a static web site (no build step). It is published with GitHub Pages at
https://leri18.github.io/WildFireCalander/

| Page | Path | Content |
|---|---|---|
| Fire Map Germany (start page) | `docs/index.html`, `app.js`, `calendar.js`, `style.css`, `data/` | A teammate's point map of every FIRMS detection in the box 5.5 to 15.5 °E, 47 to 55.5 °N from 2000-11 to 2026-11 (MapLibre). Satellite and OpenStreetMap backgrounds, filters, timeline, selection by state or by a rectangle drawn on the map, CSV download of the detections shown, and the harmonized calendar as a dialog. |
| Wildfire Calendar Argentina | `docs/argentina/` | The harmonized calendar for the validated test region, with area selection, month-against-median reading, raw sensor view and CSV downloads. |

Run the site locally:

```bash
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000 (map) or http://localhost:8000/argentina/.

### Publishing

Repository Settings, Pages, "Deploy from a branch", then choose the branch that contains
`docs/` and the folder `/docs`. The repository has to be public on the free GitHub plan.

### Rebuilding the app data

Argentina, after a new harmonization run:

```bash
python scripts/build_app_data.py --region Argentina
```

Germany (data from the FIRMS API archive, not from the yearly country archive):

```bash
python scripts/import_api_archive.py --src data/raw/api/germany --region Germany
```

```bash
python scripts/harmonize.py --region Germany --end 2026-10 --method B1
```

```bash
python scripts/build_app_data.py --region Germany --out docs/data/harm
```

`scripts/api_archive/` contains the teammate's download and packing scripts for the API
archive (they need a FIRMS MAP_KEY in `.env`, which is never committed). Results and caveats
for Germany: section 11 of the report.

Known gaps: the harmonization is validated for Argentina and weak for Germany (report,
section 11); the Argentina app ends in 2025-12 and offers cell counts, not single hot spots.

## Data acknowledgement

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource
Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land,
Atmosphere Near real-time Capability for Earth observations (LANCE)
(https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System
(ESDIS).

## AI assistance

The code in `scripts/`, the analysis and the report in `docs/HARMONIZATION_REPORT.md`
were generated with Claude (Anthropic), following the team's task description. The
harmonization idea (learning VIIRS-equivalent counts from MODIS with a machine-learning
model) is the team's.
