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

*To be added by YXY4NG from `data/outputs/aar_metrics.json`.*
