# Evaluation

Test data is never used for tuning, model choice or thresholds (D11, D20, D21). Train: 2023 · validation: Jan–Jun 2024 · test: Jul 2024–Jul 2025.

## Delay classifier (main target)

**Target (brief):** a flight at ATL/DFW is severe if `DEP_DELAY > 45` (departures) or `ARR_DELAY > 45` (arrivals).
**Data:** provided flights file (~1% sample of US flights) + provided hourly ATL/DFW weather. 25,238 labelled flights × 4 horizons (3/6/9/12 h).
**Inputs:** schedule (airport, direction, local hour, day of week, month, airline, distance) + weather observed at least *h* hours before the scheduled time (the reading at *h* plus a 10 h window ending there, incl. crosswind/tailwind). Leakage checks in `pipeline/build_delay.py`.

### Results on the test period (43,260 predictions, 4,972 severe, 11.5%)

| | PR-AUC | Precision | Recall | F1 | Accuracy | False alarms | Severe caught |
|---|---|---|---|---|---|---|---|
| Baseline: 2023 severe rate by airport × direction × hour × month | 0.157 | 0.167 | 0.408 | 0.237 | 0.698 | 10,124 | 2,028 |
| **Random Forest** (selected on validation PR-AUC 0.225) | **0.235** | **0.238** | **0.432** | **0.307** | **0.775** | **6,897** | **2,150** |
| XGBoost (validation 0.223) | 0.240 | 0.246 | 0.404 | 0.306 | 0.789 | — | — |
| LightGBM (validation 0.221) | 0.242 | 0.247 | 0.414 | 0.309 | 0.787 | — | — |

A random guess scores PR-AUC ≈ 0.115 (the share of severe flights). Each model's alert threshold maximises F1 on validation (Random Forest: risk ≥ 0.141).
On test, LightGBM and XGBoost score slightly higher than the selected Random Forest; we keep the validation choice rather than picking on test.

**By horizon (Random Forest PR-AUC):** 3 h 0.242 · 6 h 0.235 · 9 h 0.236 · 12 h 0.229 (baseline 0.157 at every horizon: it has no weather).
**By airport × direction (PR-AUC, model vs baseline):** ATL departures 0.275 vs 0.166 · ATL arrivals 0.216 vs 0.141 · DFW departures 0.246 vs 0.168 · DFW arrivals 0.189 vs 0.146.

### What weather adds, and feature tests (validation only)

`pipeline/feature_study_delay.py`, judged on validation PR-AUC (Jan–Jun 2024), each algorithm with its tuned settings, trained on 2023:

| Variant | LightGBM | XGBoost | Random Forest |
|---|---|---|---|
| Schedule only (no weather) | 0.188 | 0.189 | 0.194 |
| **Current: schedule + weather (D12, D42)** | **0.220** | **0.222** | **0.225** |
| + route (other airport) | 0.192 | 0.187 | 0.226 |
| + days to US federal holiday | 0.219 | 0.221 | 0.228 (0.224 over 3 more seeds) |
| + last-3 h weather trend | 0.221 | 0.222 | 0.226 |

- **Weather adds +0.031 to +0.033 PR-AUC (+16–18%) over the schedule alone, for every algorithm.**
- None of the extra features helps consistently: route hurts the boosted models (too many airport categories for one training year), and the small Random Forest differences are within seed noise. The feature set stays as built.

### Impact (measured on the test sample)

- Compared with the schedule-only baseline, the model raises **32% fewer false alarms** (6,897 vs 10,124) while catching **6% more** severe flights (2,150 vs 2,028).
- Of the flights it alerts on, 24% turn out severe, vs 17% for the baseline: a traffic manager acting on alerts wastes fewer actions.
- These are measured on the provided ~1% sample over the test year. Effects on full traffic volumes are an estimate, not measured.

### Failure cases (D28)

1. **ATL, 28 Dec 2024:** 7 severe flights, none flagged at 3 h (mean risk 0.09 < 0.141). Delay minutes: late-arriving aircraft 51%, air traffic system 27%, airline 22%, weather 0%. ATL had only light rain. **Why:** knock-on network delays on a peak travel day are invisible to a model that sees local weather and the schedule. **How the user knows:** low risk and no severe weather in the evidence panel; the TMC still checks inbound delays and national advisories. **Fix:** inbound-aircraft delay and network status as inputs (full BTS data with tail numbers).
2. **DFW, 28 Dec 2024:** 7 severe flights, 1 flagged at 3 h, despite a thunderstorm in the window. **Why:** winter thunderstorms are rare in the single training year, and most delay was again knock-on. **How the user knows:** the evidence panel shows a thunderstorm flag next to a low risk score. **Fix:** more training years or forecast data.

### Limits

- Weather observations only, no forecasts: storms that form after the issue time cannot be seen (EDA: observations catch ~16–27% of severe weather 3–12 h ahead).
- The largest delay cause, late-arriving aircraft, is almost never visible in the ~1% sample (the aircraft's previous flight is present for 0.7% of departures).
- Arrivals' delays are mostly set at their origin airport, which has no hourly weather here: DFW arrivals are the weakest group.
- One training year (2023): rare-season events are under-learned.
- Runway headings ATL 80°, DFW 180° are the brief's assumption; real airports switch direction.

## AAR regressor (bonus)

**Target:** AAR proxy = realised arrivals (wheels-on) per airport per UTC hour, from full BTS on-time data (D8). Not the FAA's declared rate.
**Inputs:** scheduled arrivals for the hour, calendar, and weather observed at least *h* hours before (same rule as the delay model). Pipeline: `pipeline/fetch_bts.py`, `build_aar.py`, `train_aar.py`, `export_aar.py` (YXY4NG).

### Results on the test period (Jul 2024–Jul 2025, 75,996 airport-hour × horizon rows)

| | Validation RMSE | Test RMSE | Test MAE |
|---|---|---|---|
| Baseline: 2023 average arrivals by airport × hour × day of week × month | 9.63 | 11.29 | 7.60 |
| **LightGBM** (selected among the weather models on validation) | 7.30 | **8.74** | 5.71 |
| XGBoost | 7.45 | 8.91 | 5.93 |
| Random Forest | 7.55 | 8.88 | 5.78 |
| SARIMAX (schedule-only time series) | 6.93 | 7.51 | 4.76 |

Units: arrivals per hour (ATL averages 37.5, DFW 33.7).
- The selected model cuts the baseline's error by **23%** (RMSE 8.74 vs 11.29). By airport: ATL 7.07, DFW 10.15.
- Error barely grows with horizon (ATL 7.03 at 3 h → 7.09 at 12 h).
- **SARIMAX scores lower** because it uses the arrivals counted up to the forecast time, but it has no weather input and no per-factor evidence; we keep it as a comparison rather than the product model, and state that choice (D44).
- 80% range from validation errors: about −6 to +9 arrivals around each forecast.

### Failure cases

1. **ATL, 19 Jul 2024, 11:00 UTC:** 11 arrivals against 70 scheduled; forecast 72. The global CrowdStrike IT outage grounded many Delta flights; nothing in weather or schedule shows it. **How the user knows:** actual arrivals fall far below the forecast range in the first hour, and the TMC's live traffic picture shows the gap.
2. **DFW, 16 Dec 2024, 23:00 UTC:** 0 arrivals against 65 scheduled; forecast 69. Arrivals collapsed without a weather signal 3 h earlier (likely a ground stop, outage or data gap).

### Limits

- Throughput is not capacity: in quiet hours arrivals are limited by demand, not by the airport.
- Weather observations only, no forecasts; outages and ground stops are invisible.
