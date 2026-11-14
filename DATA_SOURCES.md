# Datenquellen: Space Apps 2026, „Harmonization of MODIS and VIIRS Hot Spots“

Stand: 14.11.2026. Alles, was hier als **getestet** markiert ist, wurde am 14.11.2026 tatsächlich heruntergeladen und ausgewertet. **Nicht getestet** heißt, dass die Angabe nur von der offiziellen FIRMS-Seite stammt (Login bzw. Key fehlte).

## 0. Challenge-Kontext

- Es ist Challenge #9, verfasst von **CONAE** (der argentinischen Raumfahrtagentur). Ziel ist eine Web-App, die MODIS- und VIIRS-Hotspots zu einem **„burning activity calendar“** harmonisiert.
- ⚠️ **Nicht gegen den Originaltext verifiziert.** Die offizielle Seite `www.spaceappschallenge.org` war aus der Cloud-Umgebung nicht lesbar: Der Server liefert eine Zertifikatskette über das Cross-Sign „AAA Certificate Services“, und diesem Root vertraut die Umgebung nicht. Der Kontext oben stammt aus Suchergebnissen und Team-Repos anderer Teilnehmer. Vor allem der **Resources-Tab** ist ungeprüft: Falls CONAE dort eigene Daten verlinkt, fehlen sie hier.

## 1. Zugangswege zu den FIRMS-Daten

| # | Weg | Inhalt | Zeitraum | Login | Format | Status |
|---|-----|--------|----------|-------|--------|--------|
| 1 | **Active Fire Data** (NRT) | Hotspots, weltweit oder für 12 Regionen | nur die letzten 24 h, 48 h oder 7 Tage | nein | CSV, SHP, KML | getestet |
| 2 | **Country Yearly Summary** (SP) | ein Jahr pro Land und Sensor, Wissenschaftsqualität | MODIS 2000–2025, S-NPP 2012–2025, NOAA-20 2018–2025 | **nein** | CSV, ZIP | getestet |
| 3 | **API `area`** | Bounding Box oder `world`, 1–5 Tage pro Request, NRT **und** SP | alle Sensoren inkl. NOAA-21 und 2026 | kostenloser MAP_KEY per E-Mail | CSV | nicht getestet |
| 4 | **Archive Download** (Formular) | alles, was älter als 7 Tage ist | wie 2, dazu NOAA-21 und Landsat | Earthdata Login oder E-Mail-Code; Lieferung per E-Mail | SHP, CSV, JSON | nicht getestet |
| 5 | Tägliche Textdateien `nrt3` | NRT der letzten 2 Monate | 2 Monate | Earthdata Login | TXT | nicht getestet |
| 6 | Burned Area (MCD64A1, VIIRS) | verbrannte Fläche, z. B. zur Validierung | — | SFTP-Zugang `fuoco.geog.umd.edu`; die Zugangsdaten stehen im User Guide auf S. 17 | HDF, GeoTIFF, SHP | nicht getestet |

### URLs

```text
# 1 – NRT (Sensor-Ordner / Dateipräfix):
#   modis-c6.1/MODIS_C6_1   noaa-20-viirs-c2/J1_VIIRS_C2   noaa-21-viirs-c2/J2_VIIRS_C2
https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv
https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv
https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv
#   Regionen statt "Global": Canada, Alaska, USA_contiguous_and_Hawaii, Central_America,
#   South_America, Europe, Northern_and_Central_Africa, Southern_Africa, Russia_Asia,
#   South_Asia, SouthEast_Asia, Australia_NewZealand   |   Zeitraum: 24h, 48h, 7d

# 2 – SP-Jahresarchiv (Instrument: modis | viirs-snpp | viirs-jpss1  [= NOAA-20])
https://firms.modaps.eosdis.nasa.gov/data/country/yearly_summary_files.txt        # Index: Dateiname,Bytes,Datum
https://firms.modaps.eosdis.nasa.gov/data/country/modis/2023/modis_2023_Germany.csv
https://firms.modaps.eosdis.nasa.gov/data/country/zips/modis_2023_all_countries.zip

# 3 – API (Quellen: MODIS_NRT, MODIS_SP, VIIRS_NOAA20_NRT, VIIRS_NOAA20_SP,
#     VIIRS_NOAA21_NRT, VIIRS_NOAA21_SP, VIIRS_SNPP_NRT, VIIRS_SNPP_SP, LANDSAT_NRT)
https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[1..5]/[YYYY-MM-DD]
https://firms.modaps.eosdis.nasa.gov/api/map_key/          # Key beantragen; Limit 5000 Transaktionen / 10 min
https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/[MAP_KEY]/ALL

# 4 / 5
https://firms.modaps.eosdis.nasa.gov/download/
https://nrt3.modaps.eosdis.nasa.gov/archive/FIRMS/
```

Laut API-Übersicht (Version 4.2.8) ist der Endpunkt `country` aktuell **nicht verfügbar**. Nutzt stattdessen `area` mit einer Bounding Box.

## 2. Sensoren und Zeitabdeckung (laut FIRMS-Downloadseite)

| Sensor | Auflösung | Verfügbar |
|--------|-----------|-----------|
| MODIS C6.1 Terra | 1 km | ab 1.11.2000 |
| MODIS C6.1 Aqua | 1 km | ab Juli 2002 |
| VIIRS S-NPP | 375 m | 20.01.2012 bis **2.11.2026: eingestellt** |
| VIIRS NOAA-20 | 375 m | ab 1.04.2018 |
| VIIRS NOAA-21 | 375 m | ab 1.03.2023 laut Downloadseite, ab 17.01.2024 laut Active-Fire-Seite (FIRMS widerspricht sich hier) |
| Landsat 8/9 OLI | 30 m | ab 20.06.2022, NRT nur für USA und Kanada |

NRT-Daten werden nach etwa 2–5 Monaten durch SP-Daten (Wissenschaftsqualität) ersetzt. Für Analysen empfiehlt FIRMS ausdrücklich SP.

## 3. Gemessene Größen

**NRT, 7 Tage weltweit** (07.–14.11.2026, getestet):

| Datei | Größe | Zeilen |
|-------|-------|--------|
| MODIS (Terra + Aqua) | 5,9 MB | 77.088 |
| VIIRS NOAA-20 | 35,2 MB | 422.914 |
| VIIRS NOAA-21 | 34,3 MB | 412.633 |
| VIIRS S-NPP | 112 Byte (nur Header) | 0 |

**SP-Jahresarchiv, alle Länder** (Summe aus der Index-Datei, 10.144 Dateien):

| Instrument | Jahre | CSV entpackt | ZIP |
|------------|-------|--------------|-----|
| MODIS | 2000–2025 | 8,71 GB | 1,96 GB |
| VIIRS NOAA-20 | 2018–2025 | 12,61 GB | 2,79 GB |
| VIIRS S-NPP | 2012–2025 | 22,15 GB | 5,01 GB |
| **Summe** | | **43,5 GB** | **9,8 GB** |

NOAA-21 fehlt im Jahresarchiv und ist nur über API oder Archive Download erhältlich.

**Ganze Historie eines Landes, alle 3 Sensoren, CSV:** Griechenland 15 MB · Portugal 19 MB · Deutschland 35 MB · Argentinien 511 MB (48 Dateien, die größte hat 36 MB) · USA 1,16 GB · Brasilien 3,2 GB · DR Kongo 4,0 GB.

## 4. Passt das ins Repository?

GitHub warnt bei Dateien über 50 MiB und **blockiert Dateien über 100 MiB**. Für Repositories empfiehlt GitHub idealerweise unter 1 GB, dringend unter 5 GB (docs.github.com, „About large files on GitHub“).

| Daten | Ins Repo? | Grund |
|-------|-----------|-------|
| Weltweites Rohdatenarchiv (43,5 GB, gezippt 9,8 GB) | ❌ | Liegt weit über der 5-GB-Empfehlung. |
| VIIRS-Jahres-ZIPs (260–401 MB pro Datei) | ❌ | Jede Datei liegt über dem 100-MiB-Limit. |
| Einzelne Land-Jahr-CSVs großer Länder | ❌ | 63 Dateien sind größer als 100 MiB, die größte hat 175 MB (DR Kongo, 2024). |
| Argentinien komplett (511 MB) | ⚠️ technisch möglich, aber nicht ratsam | Git behält jede Version für immer, jeder Klon lädt die 511 MB mit. |
| Deutschland komplett (35 MB) | ⚠️ technisch ok | Wächst mit jedem weiteren Land. |
| Download-Skripte, kleine Stichproben, aggregierte Kalender (Zählungen pro Zelle × Tag) | ✅ | Klein und reproduzierbar. |

**Empfehlung:** Rohdaten gehören nach `data/raw/` (per `.gitignore` ausgeschlossen) und werden per Skript nachgeladen. Ins Repo kommen nur Code und aggregierte Ergebnisse.

## 5. Fallstricke für die Harmonisierung (in den echten Dateien beobachtet)

1. **Unterschiedliche Schemata von NRT und SP:**
   - Die Spalten `instrument` und `type` gibt es nur in SP.
   - Satellitenkürzel: in NRT `T`/`A`, in SP `Terra`/`Aqua`. S-NPP heißt in SP `N`.
   - VIIRS-`confidence`: in NRT `low`/`nominal`/`high`, in SP `l`/`n`/`h`. MODIS verwendet in beiden 0–100.
   - `version`: in NRT `6.1NRT` bzw. `2.0NRT`, in SP `61.03` bzw. `2`.
   - Helligkeitsspalten: MODIS hat `brightness`/`bright_t31`, VIIRS `bright_ti4`/`bright_ti5`.
2. **Statische Quellen dominieren:** In Deutschland 2023 (SP) sind `type = 2` (Industrie, Fackeln usw.) **68 % der MODIS-, 78 % der NOAA-20- und 80 % der S-NPP-Detektionen**. Nur `type = 0` steht für Vegetationsfeuer. NRT hat keine `type`-Spalte, deshalb braucht ihr eine Maske aus der SP-Historie.
3. **Rohzählungen sind nicht vergleichbar:** In derselben NRT-Woche lieferte **ein** VIIRS-Satellit 5,4- bis 5,5-mal so viele Detektionen wie MODIS Terra und Aqua zusammen (statische Quellen eingeschlossen). Für Deutschland 2023, nur Vegetationsfeuer: NOAA-20 3.332, S-NPP 2.992, MODIS 812 (Faktor 4,1 bzw. 3,7).
4. **Sprünge in der Zeitreihe:**
   - Aqua kam erst im Juli 2002 dazu. Die MODIS-Archivgröße springt von 139 MB (2001) über 289 MB (2002) auf 400 MB (2003).
   - S-NPP endete am 2.11.2026. NOAA-20 und NOAA-21 fliegen in derselben Bahnebene, etwa 50 Minuten versetzt.
   - Terra liefert den einzigen Vormittags-Überflug. FIRMS empfiehlt, sich für laufende Anwendungen von MODIS zu lösen.
5. **Überlappung für die Kalibrierung:** MODIS und S-NPP überlappen 2012–2025 (14 Jahre), MODIS und NOAA-20 2018–2025.
6. **Fehlende Beobachtung ist nicht dasselbe wie „kein Feuer“:** Ausfälle lassen sich über `/api/missing_data/` abfragen.

## 6. Pflicht-Zitat (laut FIRMS)

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS).

## 7. Referenzen

- Attributtabellen MODIS/VIIRS: https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs
- FIRMS FAQ (Unterschiede NRT und SP): https://www.earthdata.nasa.gov/data/tools/firms/faq
- MODIS C6/C6.1 Fire User Guide: https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf
- VIIRS 375 m Active Fire User Guide: https://viirsland.gsfc.nasa.gov/PDF/VIIRS_activefire_User_Guide.pdf
- Ankündigung zum Ende von S-NPP: https://www.earthdata.nasa.gov/news/blog/transitioning-from-suomi-npp-viirs-omps-what-firms-users-need-know
- Giglio, L., Schroeder, W., Justice, C.O. (2016): *The collection 6 MODIS active fire detection algorithm and fire products.* Remote Sensing of Environment 178: 31–41. doi:10.1016/j.rse.2016.02.054
- Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. (2014): *The New VIIRS 375 m active fire detection data product.* Remote Sensing of Environment 143: 85–96. doi:10.1016/j.rse.2013.12.008
