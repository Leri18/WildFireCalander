# Datenquellen: Space Apps 2026, „Harmonization of MODIS and VIIRS Hot Spots“

Stand: 14.11.2026. Alles, was hier als **getestet** markiert ist, wurde am 14.11.2026 tatsächlich heruntergeladen und ausgewertet. **Nicht getestet** heißt, dass die Angabe nur von der offiziellen FIRMS-Seite stammt (Login bzw. Key fehlte).

## 0. Challenge: Anforderungen und was sie für die Daten bedeuten

Grundlage ist der offizielle Details-Tab der Challenge „Harmonization of MODIS and VIIRS Hot Spots“ (Schwierigkeit: Intermediate/Advanced; Themen: Earth Science, Software). Die Challenge nennt FIRMS ausdrücklich als Datenbasis: *„You may consider harmonizing NASA Earthdata FIRMS hotspots“*.

Sie besteht aus zwei Teilen:
1. MODIS und VIIRS so harmonisieren, dass der Ursprungssensor keine Rolle mehr spielt.
2. Eine Web-App bauen, die die harmonisierten Daten als Kalender zeigt.

| Anforderung (offizieller Text) | Datenbedarf | Bezugsweg |
|---|---|---|
| Hotspot-Anzahl *„from the early 2000s to the present“* | MODIS ab 11/2000 bis heute, VIIRS ab 2012 | SP-Jahresarchiv bis 2025. 2026 kommt über die API: SP bis Ende Juli bzw. August, danach NRT (siehe Abschnitt 2). |
| *„compare the burning activity of the current month against the historical median“* | der **komplette laufende Monat** als NRT | API `area` mit `*_NRT` (5 Tage pro Request) oder `nrt3` (2 Monate, Earthdata Login). Die 7-Tage-Dateien reichen dafür nicht. |
| Region frei wählen (auf der Karte zeichnen oder Lat/Lon eingeben), dazu einen Zeitraum | räumlich aufgelöste Daten statt Länder-Summen | Punktdaten oder Raster (Zelle × Monat) |
| *„downloadable CSV File of hot spots detected during a search“* | **Punktdaten** für jede Auswahl | eigene Parquet-Dateien (siehe Abschnitt 4) |
| aktivste Monate und Jahre; Anomalien gegenüber dem mehrjährigen Mittel | Monatsaggregate pro Region, Median bzw. Mittel über alle Jahre | aus den harmonisierten Daten |
| Laut Text zählen auch Feuer aus Landwirtschaft, Müllverbrennung und **Industrie** zur „burning activity“. | statische Quellen nicht pauschal entfernen | Feld `type` (nur in SP), siehe Abschnitt 5 |

**Resources-Tab:** Er nennt als einzige Ressource die FIRMS-Seite auf Earthdata und listet keine Partnerdaten. Alle Zugangswege dieser Seite stehen in Abschnitt 1.

⚠️ Weiter ungeprüft: CONAE als Autorin. Die Seite nennt CONAE nur als Bildquelle („Photo credit“).

Die Seite `www.spaceappschallenge.org` lässt sich aus der Cloud-Umgebung nicht abrufen, weil ihre Zertifikatskette über „AAA Certificate Services“ läuft und dieser Root dort fehlt.

## 1. Zugangswege zu den FIRMS-Daten

| # | Weg | Inhalt | Zeitraum | Login | Format | Status |
|---|-----|--------|----------|-------|--------|--------|
| 1 | **Active Fire Data** (NRT) | Hotspots, weltweit oder für 12 Regionen | nur die letzten 24 h, 48 h oder 7 Tage | nein | CSV, SHP, KML | getestet |
| 2 | **Country Yearly Summary** (SP) | ein Jahr pro Land und Sensor, Wissenschaftsqualität | MODIS 2000–2025, S-NPP 2012–2025, NOAA-20 2018–2025 | **nein** | CSV, ZIP | getestet |
| 3 | **API `area`** | Bounding Box oder `world`, 1–5 Tage pro Request, NRT **und** SP | alle Sensoren inkl. NOAA-21 und 2026 | kostenloser MAP_KEY per E-Mail | CSV | getestet |
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
| VIIRS NOAA-21 | 375 m | SP ab 1.03.2023, NRT ab 17.01.2024 (laut API; daher die zwei verschiedenen Daten auf den FIRMS-Seiten) |
| Landsat 8/9 OLI | 30 m | ab 20.06.2022, NRT nur für USA und Kanada |

NRT-Daten werden nach etwa 2–5 Monaten durch SP-Daten (Wissenschaftsqualität) ersetzt. Für Analysen empfiehlt FIRMS ausdrücklich SP.

**Verfügbarkeit laut API** (`/api/data_availability/csv/[MAP_KEY]/ALL`, abgefragt am 14.11.2026):

| Quelle | SP | NRT |
|--------|----|-----|
| MODIS | 01.11.2000 – 31.08.2026 | 01.09.2026 – heute |
| VIIRS NOAA-20 | 01.04.2018 – 31.07.2026 | 01.08.2026 – heute |
| VIIRS NOAA-21 | 01.03.2023 – 31.07.2026 | 17.01.2024 – heute |
| VIIRS S-NPP | 20.01.2012 – 31.07.2026 | 01.08.2026 – 02.11.2026 |
| Landsat | — | 20.06.2022 – heute |
| GOES (geostationär) | — | 09.08.2022 – heute |
| Burned Area MODIS / VIIRS | ab 01.11.2000 bzw. 01.03.2012, jeweils bis 01.08.2026 | — |

Für einen Kalender „bis heute“ heißt das: SP bis Ende Juli bzw. August 2026, danach NRT. Diese Grenze wandert mit jedem SP-Nachschub nach hinten, deshalb immer `version` mitspeichern.

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

**Parquet statt CSV** (gemessen an 8 echten Dateien mit zusammen 1,52 Mio. Zeilen): Parquet mit zstd-Kompression ist 2,8- bis 4,9-mal kleiner als CSV, im Schnitt 4,0-mal. Das sind etwa 21 Byte pro Hotspot.

**Aggregation** (gemessen an Argentinien 2020): Ein Raster aus Zelle × Monat hat bei 0,25° 11- bis 29-mal weniger Zeilen als die Rohpunkte, bei 0,1° 5- bis 11-mal weniger. Ein Raster aus Zelle × Tag spart nur das 2- bis 6-Fache.

| Daten | CSV | Parquet (geschätzt aus den gemessenen Faktoren) | Ins Repo? |
|-------|-----|----------------------------|-----------|
| Weltweites Archiv 2000–2025 | 43,5 GB (gezippt 9,8 GB) | ≈ 11 GB | ❌ Liegt über der 5-GB-Empfehlung und braucht externen Speicher. |
| VIIRS-Jahres-ZIPs | 260–401 MB pro Datei | — | ❌ Jede Datei liegt über dem 100-MiB-Limit. |
| Land-Jahr-CSVs großer Länder | 63 Dateien > 100 MiB, die größte 175 MB | — | ❌ |
| Argentinien komplett (3 Sensoren) | 511 MB | ≈ 120 MB | ✅ wenn nach Jahr und Sensor aufgeteilt (jede Datei < 10 MB) |
| Deutschland komplett | 35 MB | ≈ 9 MB | ✅ |
| Monatsraster pro Region, Skripte | — | klein | ✅ |

**Folge der CSV-Download-Anforderung** (siehe Abschnitt 0): Die App braucht **Punktdaten**, Aggregate allein reichen nicht.
- Für den Hackathon realistisch ist **eine Demo-Region als aufgeteiltes Parquet**, abfragbar z. B. mit DuckDB.
- Diesen Datenstand **einmal** committen. Wer ihn bei jeder Iteration neu committet, legt jedes Mal ca. 120 MB in die Git-Historie.
- Weltweit geht es nur mit externem Speicher.
- Roh-CSVs gehören weiter nach `data/raw/` (per `.gitignore` ausgeschlossen).

## 5. Fallstricke für die Harmonisierung (in den echten Dateien beobachtet)

1. **Drei Schemata für dieselben Daten:** Die NRT-Dateien (Active Fire Data), die API-Antworten und das SP-Archiv unterscheiden sich.
   - `type` gibt es nur in SP (Jahresarchiv und API mit `*_SP`). `instrument` fehlt nur in den NRT-Dateien.
   - Satellitenkürzel: in den NRT-Dateien `T`/`A`, in SP `Terra`/`Aqua`. S-NPP heißt in SP `N`.
   - VIIRS-`confidence`: in den NRT-Dateien `low`/`nominal`/`high`, in API und SP `l`/`n`/`h`. MODIS verwendet überall 0–100.
   - `acq_time`: in den Dateien vierstellig (`0040`), in der API ohne führende Nullen (`414`). Als Zahl lesen und auf vier Stellen auffüllen.
   - `version`: in NRT `6.1NRT` bzw. `2.0NRT`, in SP `61.03` bzw. `2`.
   - Helligkeitsspalten: MODIS hat `brightness`/`bright_t31`, VIIRS `bright_ti4`/`bright_ti5`.
2. **Statische Quellen: stark regionsabhängig.**
   - In Deutschland 2023 (SP) fallen **68 % der MODIS-, 78 % der NOAA-20- und 80 % der S-NPP-Detektionen** unter `type = 2` („other static land source“). In Argentinien 2020 sind es nur 2,6 % (MODIS) bzw. 1,1 % (S-NPP).
   - Die Challenge zählt Industrie-Feuer ausdrücklich zur „burning activity“. Deshalb diese Quellen nicht pauschal entfernen, sondern einen Filter anbieten.
   - Entscheidend ist die **Konsistenz**: Die NRT-Daten des laufenden Monats haben keine `type`-Spalte. Wer die Historie (SP) filtert, muss denselben Filter über eine Maske aus der SP-Historie auch auf NRT anwenden. Sonst erzeugt der Vergleich „aktueller Monat gegen Median“ künstliche Anomalien.
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

## 8. Abgaberegeln mit Folgen für Repo und App

Quelle: offizieller „Project Submission Guide“ von Space Apps, Stand 13.11.2026.

- **Frist:** Sonntag, 15.11.2026, 23:59 Uhr Ortszeit des Local Events. Es zählt nur die zuletzt gespeicherte Abgabe.
- **Englisch:** Die Projektseite *„and any linked materials“* müssen auf Englisch sein. Diese Datei ist deutsch und muss vor der Abgabe übersetzt oder aus den verlinkten Inhalten herausgehalten werden.
- **Öffentlicher Link ohne Login:** Das gilt für die Demo und das finale Projekt. Ein MAP_KEY im Frontend wäre damit öffentlich, und jeder könnte das Limit von 5000 Transaktionen pro 10 Minuten aufbrauchen. Deshalb Daten vorab laden oder über ein eigenes Backend abfragen. Den Key nur in `.env` ablegen (per `.gitignore` ausgeschlossen).
- **NASA-Daten:** Mindestens eine NASA-Quelle ist Pflicht für Global Awards. FIRMS erfüllt das. Im Feld „NASA Data“ konkret Produkte und Sensoren nennen.
- **KI-Nutzung (SI):**
  - Erlaubt, aber KI-generierter Code und KI-generierte Daten müssen *„in descriptive text and metadata“* gekennzeichnet werden.
  - Die Lösungsidee selbst darf laut Regel nicht von der KI stammen.
- **Demo:** höchstens 7 Folien oder 30 Sekunden Video. Wer darüber liegt, wird im Global Judging nicht berücksichtigt.
- **Bewertung:** Impact, Creativity, Validity, Relevance, Presentation.
- **Partnerdaten:** Daten der Partneragenturen (u. a. CONAE, ESA, JAXA) sind ausdrücklich erwünscht, aber keine Pflicht.
