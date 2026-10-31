# Predictive Airport Capacity & Risk Model (ATL / DFW)

Autonomous SG 2026 · Airbus Challenge 5: warn a **Traffic Management Coordinator (TMC)** at Atlanta (ATL) or Dallas Fort Worth (DFW) **3–12 hours ahead** which flights face a severe delay (> 45 min), and forecast the hourly **arrival acceptance rate (AAR)**.

## The problem

When severe weather reaches a hub, controllers cut arrival and departure rates only once it arrives, so aircraft end up in airborne holding or stuck on taxiways, wasting fuel and causing knock-on cancellations (challenge brief). A TMC who sees the risk 3–12 hours earlier can plan rate reductions and delay programs before the weather hits.

## What it does

| Part | Method | Output |
|---|---|---|
| Severe-delay risk per flight (main target) | Random Forest / XGBoost / LightGBM classifier, tuned with Optuna on PR-AUC; best chosen on validation | Risk 0–1 per flight at 3, 6, 9, 12 h ahead, alert above a threshold, top 3 reasons (SHAP) with the time each weather reading was taken |
| Hourly AAR (bonus) | Random Forest / XGBoost / LightGBM / SARIMAX regressor, tuned with Optuna on RMSE | Arrivals per hour 3–12 h ahead, with a range |
| Dashboard | Next.js | Risk board, AAR forecast, historical trends (rates), model performance, rule-based recommendations |
| TMC briefing | Claude (reads model outputs only, never computes risk) | Plain-language shift briefing citing the timestamped signals |

Statistics and ML do the prediction; Claude only explains it. The TMC makes the final call.

## Results

Full results, failure cases and limits: [`docs/EVALUATION.md`](docs/EVALUATION.md).

Severe-delay classifier on the test year (Jul 2024–Jul 2025, 43,260 predictions, 11.5% severe):

| | PR-AUC | Precision | Recall | F1 | Accuracy |
|---|---|---|---|---|---|
| Baseline (2023 severe rate by airport × direction × hour × month) | 0.157 | 0.167 | 0.408 | 0.237 | 0.698 |
| Random Forest (selected on validation) | **0.235** | **0.238** | **0.432** | **0.307** | **0.775** |

32% fewer false alarms than the baseline while catching 6% more severe flights.

## Assumptions

- Severe delay exactly as the brief: `DEP_DELAY > 45` (departures), `ARR_DELAY > 45` (arrivals). Cancelled/diverted flights have no delay value, so they have no label.
- Only weather observed at least *h* hours before the scheduled time is used for an *h*-hour forecast (brief: at least 3 h). Flight local times are converted to UTC before matching weather.
- Runway headings ATL 80°, DFW 180° (brief); real airports switch runway direction.
- Weather observations only, no forecasts: storms that form later cannot be seen.
- AAR proxy = realised arrivals (wheels-on) per hour from full BTS data, not the FAA's declared rate.
- Flights in the repeated autumn daylight-saving hour are dropped.
- Train on 2023, tune on Jan–Jun 2024, test once on Jul 2024–Jul 2025.

## How to run

Requires Python 3.13 with [uv](https://docs.astral.sh/uv/) and Node.js 22.20+.

```
uv sync

# Delay classifier (provided data in data/raw/)
uv run python pipeline/build_delay.py
uv run python pipeline/train_delay.py
uv run python pipeline/export_delay.py

# AAR regressor (downloads full BTS data, ~0.9 GB)
uv run python pipeline/fetch_bts.py
uv run python pipeline/build_aar.py
uv run python pipeline/train_aar.py

# Weather for any airport code (Meteostat)
uv run python pipeline/fetch_weather.py --airports ATL DFW

# Dashboard
npm install
npm run dev
```

The dashboard reads the JSON files in `data/outputs/`. The TMC briefing needs an Anthropic API key in `.env.local` (not committed).

## Data sources

- **Challenge 5 provided data** (Airbus / Acacia Hackathon Society): `Flight_Data_With_Weather_Final.csv` (flight sample, 2023-01 to 2025-07), `challenge5_hourly_weather_ATL_DFW.csv` (hourly weather with runway wind components), `challenge5_data_guide.xlsx`.
- **U.S. Bureau of Transportation Statistics**, Reporting Carrier On-Time Performance (1987–present), monthly files from https://transtats.bts.gov/PREZIP/ (public domain). Used for the AAR target.
- **Meteostat** bulk hourly data (https://dev.meteostat.net/bulk/hourly.html), built from NOAA ISD observations; stations 72219 (ATL) and 72259 (DFW). Licence CC BY-NC 4.0. Source of the provided hourly weather file, and used to fetch weather for other airports.
- Further airport data for other airport codes (station lists, runways, IATA/ICAO codes) is cited in `pipeline/fetch_weather.py`.

All external data is public and downloaded by script.
