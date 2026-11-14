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
- `docs/index.html`, `docs/app/`: the calendar web app
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

## Web app

`docs/` contains the calendar as a static web app (no build step, no external requests):
`docs/index.html`, `docs/app/app.js`, `docs/app/style.css` and the packed data in
`docs/app/data/`. It offers a map to select an area (drag a box or type its edges), the
harmonized calendar with year totals and the median of every calendar month, a comparison
of any month with the median of its calendar month, a switch to the raw sensor counts, and
CSV downloads for the selection.

Run it locally:

```bash
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000. To publish it, enable GitHub Pages for the `docs/` folder
of the default branch (repository Settings, Pages, "Deploy from a branch").

After a new harmonization run, repack the app data:

```bash
python scripts/build_app_data.py --region Argentina
```

Known gaps of the demo: one region (Argentina), archive ends 2025-12 (no current month yet),
downloads contain counts per cell and month, not the individual hot-spot records.

## Second region: Germany

`docs/germany/` holds a teammate's point map for Germany (MapLibre, all FIRMS sensors,
2000-11 to 2026-11) with the harmonized calendar added as a dialog. It is served at
`/germany/` next to the Argentina app. Its data comes from the FIRMS API, not from the
yearly country archive:

```bash
python scripts/import_api_archive.py --src data/raw/api/germany --region Germany
```

```bash
python scripts/harmonize.py --region Germany --end 2026-10 --method B1
```

```bash
python scripts/build_app_data.py --region Germany --out docs/germany/data/harm
```

`scripts/api_archive/` contains the teammate's download and packing scripts for the API
archive (they need a FIRMS MAP_KEY in `.env`, which is never committed). The interface of
this app is in German. Results and caveats: section 11 of the report.

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
