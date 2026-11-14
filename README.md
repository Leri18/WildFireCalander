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
