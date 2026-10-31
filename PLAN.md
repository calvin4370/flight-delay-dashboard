# Team Plan: Airbus Challenge 5

**Predictive Airport Capacity & Risk Model** for ATL and DFW: warn 3–12 h ahead which flights face a severe delay (> 45 min), and forecast hourly arrival rate (AAR, bonus).

**Submissions close 4:15 PM.** Time discipline is scored on the **first valid submission**.

Sources: `docs/problem_statements/` (updated brief + summary of updates), `data/raw/challenge5_data_guide.xlsx`, EDA in `notebooks/eda.ipynb`.

---

## How to use this file (humans and Claude Code)

- This is the **single source of truth** for tasks and decisions. Read it before starting work.
- Task states: `- [ ]` to do · `- [~]` in progress · `- [x]` done. Add an owner and short note: `- [~] Task (name + Claude) — note`.
- **Claim a task before starting it** (mark `[~]` with your name) so two people don't do the same thing.
- **Add tasks** under the right workstream as you discover them. Don't delete other people's tasks; mark them done or strike them out with a reason.
- **Decisions are made by humans.** Claude may propose options, but only a team member moves a decision to *Decided*, with their name.
- Don't build on anything that depends on an *Open* decision until it is decided.
- Keep entries short. Put details in code, notebooks or commit messages.

---

## Brief requirements

Every requirement from the updated brief (Challenge #5), the Summary of Updates and the judging rubric. Tick when the build meets it.

| ✓ | Requirement | Source | Covered by |
|---|---|---|---|
| [x] | Merge weather logs with flight delay records on time and airport | Brief: want to see | WS1 |
| [x] | Delay risk classification (main target): flights facing a severe delay (> 45 min); `ARR_DELAY > 45` arrivals, `DEP_DELAY > 45` departures at ATL/DFW | Brief + update | D3, WS2 |
| [x] | Report precision and recall, not only accuracy | Update | D21, WS2 |
| [x] | AAR (optional bonus): hourly AAR forecast, measured by RMSE | Brief + update | D5, WS3 |
| [x] | Interactive dashboard for ATC: risk scores, historical trends and recommendations | Brief: want to see | WS5 |
| [x] | Scripts download and process public data with no manual steps | Brief: want to see | WS1 |
| [x] | No leakage: only weather observed ≥ 3 h before the scheduled time; use the hourly file | Brief: avoid + update | D4, WS1 |
| [x] | Use crosswind and tailwind components, not raw wind speed | Brief: avoid | WS1 |
| [x] | Pipeline accepts any airport code (IATA or ICAO); demo and score on ATL and DFW | Brief: avoid + update | D13, WS1 — resolver + AAR pipeline done (`a2aa764`); delay pipeline done (`build_delay.py --airports KORD` checked) |
| [x] | Compare delay rates, not raw delay minutes, across airports | Brief: avoid + data guide | WS5 |
| [x] | Ignore placeholder columns `wpgt_*` and `snow_*` | Update + data guide | WS1 |
| [x] | External data only if public, cited and fetched by a script; no paid or private data | Update | WS1 |
| [x] | State assumptions clearly in the demo | Update | WS8 — Assumptions panel on every app view (`7563f54`); pitch: Calvin |
| [x] | Named user, current process, cost in time, money or risk | Rubric: problem realism | D6, WS8 |
| [x] | | Working end to end, tested beyond a scripted demo; LLM for reading/explanation, statistics/ML for detection | Rubric: technical soundness | WS1–7 |
| [x] | Baseline, measured results, a visible failure case with a reason, and how the user knows | Rubric: honest evaluation | D22, D28, WS7 |
| [x] | Claims traceable to timestamped signals or applied rules; uncertainty visible; human stays in control | Rubric: trust & traceability | D27, WS5 |
| [x] | Before/after vs the baseline, measured vs estimated kept separate; realistic adoption constraints | Rubric: impact | WS7 |
| [ ] | Early first valid submission; pitch under 3 minutes | Rubric: time discipline + update | D32, WS8 |
| [ ] | Submit before 4:15 PM | Update | WS8 |

---

## Decisions

### Decided

| # | Decision | By |
|---|---|---|
| D1 | Stack: Python (uv) for data/ML, Next.js for the app | Calvin |
| D2 | Plan lives in `PLAN.md`; `CLAUDE.md` points Claude Code sessions to it | Calvin |
| D3 | Main target: ATL/DFW departures `DEP_DELAY > 45`, arrivals `ARR_DELAY > 45` | Organizers' update |
| D4 | Only weather observed ≥ 3 h before the scheduled time may be an input | Organizers' update |
| D5 | Go for the AAR bonus (hourly AAR, RMSE) | Calvin |
| D6 | User: ATL/DFW Traffic Management Coordinator (FAA Traffic Management Unit) | Calvin |
| D7 | AAR data: full BTS On-Time monthly files, Jan 2023–Jul 2025, fetched by script | Calvin |
| D8 | AAR target: actual arrivals (wheels-on) per airport per UTC hour from BTS, stated as "AAR proxy = realised arrival throughput" | Calvin |
| D9 | Delay label exactly as the brief (D3) | Calvin |
| D10 | Delay classifier horizons: 3, 6, 9, 12 h as an input; each row repeated per horizon with only the weather allowed at that horizon; app shows risk at each horizon | Calvin |
| D11 | Time split: train 2023 · validate Jan–Jun 2024 (Optuna + threshold) · test Jul 2024–Jul 2025 | Calvin |
| D12 | Delay classifier features: schedule (airport, direction, hour, day of week, month, carrier, distance) + weather at 3/6/9/12 h lookbacks incl. crosswind/tailwind + 3–12 h window summaries (max precip, any rain/severe/thunder, max wind/crosswind/tailwind, pressure change) | Calvin |
| D13 | External data: BTS (D7) + for any airport code, a script fetches hourly weather from Meteostat / NOAA ISD (same source as the provided file) and time zone, runways and IATA/ICAO codes from a public airport database; no forecasts | Calvin |
| D14 | Claude writes a TMC shift briefing from model outputs (at-risk hours/flights and why, citing timestamped weather signals); never invents numbers; says so when data is missing | Calvin |
| D15 | Folders: `pipeline/` (Python: fetch, build, train, evaluate, export); `data/raw`, `data/processed`, `data/models`, `data/outputs`; app stays in `src/` | Calvin |
| D16 | Two models: one delay classifier and one AAR regressor, each covering both airports and all horizons | Calvin |
| D17 | Delay classifier candidates: Random Forest, XGBoost, LightGBM | Calvin |
| D18 | AAR regressor candidates: Random Forest, XGBoost, LightGBM, SARIMAX | Calvin |
| D19 | No LSTM | Calvin |
| D20 | Hyperparameter tuning with Optuna; tune delays on PR-AUC, AAR on RMSE | Calvin |
| D21 | Delay alert threshold: maximise F1 on the validation period; report precision, recall, accuracy and confusion matrix at that threshold | Calvin |
| D22 | Baselines, computed from the training period only: delays = historical severe rate for the same airport, direction, hour and month; AAR = historical average arrivals for the same airport, hour, day of week and month | Calvin |
| D23 | Packages approved: lightgbm, optuna, statsmodels, scikit-learn, shap; **xgboost** (needed by D17/D18) | Calvin; xgboost approved by YXY4NG |
| D24 | Contract: pipeline writes JSON to `data/outputs/` (flight risks, hourly AAR forecasts, metrics, trends); the Next.js app reads it directly | Calvin |
| D25 | App views: Risk board (flights/hours with risk at 3/6/9/12 h + evidence), AAR forecast (vs baseline, next 3–12 h), Historical trends (rates, not minutes), Model performance (precision/recall/confusion matrix, RMSE vs baselines, failure case) | Calvin |
| D26 | Recommendations: fixed rules on model outputs (each shows the rule that fired); Claude only words them in the briefing | Calvin |
| D27 | Explanations: SHAP per prediction (top features with values and observation timestamps) | Calvin |
| D28 | Failure case(s) picked from test-set results after evaluation, with a reason | Calvin |
| D29 | No reference wind limits; crosswind/tailwind are model inputs only | Calvin |
| D30 | Provided files are versioned in `data/raw/`; scripts read them directly, no manual step; external data is downloaded by script | Calvin |
| D31 | Rules for every Claude Code session (in `CLAUDE.md`): humans run all git commands; ask before adding packages | Calvin |
| D34 | AAR regressor mirrors the delay model: horizons 3/6/9/12 h as an input; features = scheduled arrivals that hour + calendar (hour, day of week, month) + weather lookbacks incl. crosswind/tailwind + 3–12 h window summaries; same D11 split | Calvin |
| D37 | D35 and D36 are drafted by Claude as *Open* proposals when the work starts, and approved by a team member before anything is built on them | Calvin |
| D40 | Flight local times are converted to UTC (per airport time zone) before matching to the hourly weather | Calvin |
| D41 | Workload split as in "Workload split" below | Calvin, YXY4NG |
| D42 | Weather features per horizon (brief: at horizon h, only weather observed ≥ h hours before): the reading at h hours before + summaries of the 10 hours ending there; applies to D12 and D34 | Calvin |
| D32 | No early submission: one submission before the 16:15 deadline (final by 16:05 as buffer) | Calvin |
| D35 | Output contract: the D35 proposal below, approved. Export the **whole test period** (not only demo days) so the app works on any date; `top_factors[]` up to 3 per prediction to keep files small | Claude (delegated by Calvin) |
| D39 | Airport data: option A (Meteostat station list + OurAirports), no new package | Claude (delegated by Calvin) |
| D43 | Flights in the repeated autumn daylight-saving hour are dropped; stated as an assumption | Claude (delegated by Calvin) |
| D44 | WS3 review notes: AAR best model is selected on validation RMSE (not test); SARIMAX stays without weather as a time-series comparison, stated in results; YXY4NG fills in who approved xgboost in D23 | Claude (delegated by Calvin) |
| D36 | Recommendation rules R1–R4 as in `src/lib/rules.ts` (R1 forecast < 85% of scheduled and ≥ 5 short → review arrival rate; R2 weather window lowers forecast → brief it with observation time; R3 ≥ 3 flights in one local hour above the D21 threshold → notify airlines / Command Center; R4 80% range > 60% of forecast → low confidence, check live traffic), approved | Claude (delegated by Calvin) |
| D45 | Dashboard reorganised into 4 tabs, main target first: 1 Delay risk (flights sorted by risk, alert line, reasons, actual) · 2 Arrival capacity (AAR bonus) · 3 Historical trends (rates) · 4 Model evidence; recommendations + briefing beside tabs 1–2; every number labelled with its model. Calvin's Claude rebuilds `src/app/page.tsx` (YXY4NG pauses `src/` edits until pushed) | Calvin |

### Open

| # | Question |
|---|---|
| — | none |

### D35 output JSON contract (approved, see D35 above)

All files in `data/outputs/`, UTF-8 JSON, times as ISO strings (`time_utc` plus `time_local`). Every file starts with
`"generated_utc"`, `"source"` (script name) and `"split"` (D11 dates). Missing values are `null`, never invented.

| File | Owner | Top-level fields |
|---|---|---|
| `aar_forecast.json` | YXY4NG | `hours[]`: `airport`, `time_utc`, `time_local`, `horizon_h`, `issue_utc`, `predicted_arrivals`, `interval_low`, `interval_high` (80% range from validation errors at that horizon), `baseline_arrivals`, `scheduled_arrivals`, `actual_arrivals` (null if not yet known), `top_factors[]` |
| `aar_metrics.json` | YXY4NG | `selected_model` + `selected_on` ("validation"), `models[]` with `name`, `validation_rmse`, `test_rmse` and `test_mae` (overall, per airport, per airport × horizon), `baseline` (same fields), `failure_cases[]` |
| `delay_flights.json` | Calvin | `flights[]`: `flight_id`, `airport`, `direction` (departure/arrival), `carrier`, `flight_number`, `origin`, `dest`, `sched_utc`, `sched_local`, `horizon_h`, `issue_utc`, `risk` (0–1), `alert` (risk ≥ `threshold`), `baseline_rate`, `actual_severe` (null if unknown), `top_factors[]` |
| `delay_metrics.json` | Calvin | `threshold` (max F1 on validation, D21), `selected_model`, `models[]` with `pr_auc`, `precision`, `recall`, `accuracy`, `f1`, `confusion_matrix` {`tp`,`fp`,`fn`,`tn`} on test, overall and per airport × direction; `baseline` (same fields); `failure_cases[]` |
| `delay_trends.json` | Calvin | `severe_rate` tables (rates, never raw minutes) by airport × direction × {`month`, `local_hour`, `weather_group`}, each cell with `rate` and `n` |

Shared shapes:
- `top_factors[]` (D27): up to 5 × {`feature`, `label` (plain words), `value`, `shap`, `observed_utc` (timestamp of the weather reading, null for schedule features)}.
- `failure_cases[]` (D28): {`airport`, `time_utc`, `what_happened`, `predicted`, `actual`, `reason`, `how_user_knows`}.
- **Demo window (decided in D35: whole test period):** export the **whole test period** (large: ~76k AAR rows, likely tens of MB) or **only chosen demo days** (e.g. 3–5 test days incl. one severe-weather day and one failure day) for the risk board, with metrics always on the full test period.

### D39 options: airport data for any airport code (D13)

| Option | What it gives | Package |
|---|---|---|
| **A. Meteostat station list + OurAirports** (recommended) | Meteostat `stations/lite.json` maps ICAO → weather station id + IANA time zone (checked: KATL → 72219, America/New_York; KORD → 72530); OurAirports `airports.csv` maps IATA ↔ ICAO; `runways.csv` gives runway headings. Both public, fetched by script | none (urllib + pandas) |
| B. OpenFlights `airports.dat` | IATA, ICAO, coordinates, IANA time zone in one file; no runways; data not updated since ~2017 | none |
| C. `airportsdata` Python package | IATA/ICAO, coordinates, time zone; no runways; needs a weather-station lookup anyway | adds a package |

Runway heading for a new airport: the brief only fixes ATL/DFW; for others, use the most common runway direction from OurAirports and state it as an assumption.

## Assumptions to state in the demo

- [ ] Runway headings ATL 80°, DFW 180° (brief)
- [ ] Flights in the repeated autumn daylight-saving hour are dropped (D43)
- [ ] AAR proxy = realised arrival throughput from BTS, not the FAA's declared rate (D8)
- [ ] Weather observations only, no forecasts (D13)
- [ ] AAR proxy counts only flights that landed: cancelled and diverted flights are not arrivals (D8)
- [ ] AAR features use scheduled arrivals for the target hour, known in advance from the published schedule (D34)
- [ ] Arrivals in the repeated autumn daylight-saving hour are dropped (ambiguous local time; a few flights a year)

---

## Workload split (D41, decided)

Goal: each person works in their own files on `main`, so changes land one after another without merge clashes.

| | **Calvin** | **YXY4NG** |
|---|---|---|
| Owns | WS2 delay classifier; delay side of WS1; WS7 evaluation write-up; WS8 pitch and submission | WS3 AAR regressor; any-airport fetch in WS1 (D13, D39); WS4 contract; WS5 app; WS6 Claude briefing |
| Files | `pipeline/build_delay.py`, `pipeline/train_delay.py`, `data/outputs/delay_*`, `notebooks/`, `pyproject.toml` + `uv.lock` (adds `shap`) | `pipeline/*_aar.py`, `pipeline/fetch_bts.py`, `pipeline/fetch_weather.py` (+ airport data), `data/outputs/aar_*`, `src/` (app) |
| Drafts (D37) | — | D35 JSON fields, D36 recommendation rules |

**Order of work**
1. In parallel: Calvin builds delay features and trains the delay classifier; YXY4NG runs the AAR pipeline, goes through the review notes in WS3, then drafts D35 and starts the app against `aar_*` outputs.
2. Calvin writes `data/outputs/delay_*` in the D35 format; YXY4NG wires the delay outputs into the app.
3. Both: evaluation (each writes their own model's results), then Calvin assembles the pitch and submits.

**Rules to avoid clashes**
- Only edit files you own. To change someone else's file, ask them.
- Shared code: the delay pipeline may import `weather_features()` from `pipeline/build_aar.py` but doesn't edit it; YXY4NG announces any change to it.
- Packages: only one person changes `pyproject.toml` / `uv.lock` at a time (Calvin adds `shap`); everyone runs `uv sync` after pulling.
- `PLAN.md`: pull first, edit only your own task lines, commit plan changes on their own, and push straight away.
- Everyone pushes straight to `main`: pull before every commit and push; commit small, push often.

## Workstreams

### 0. Setup and coordination
- Branches: **everyone works on `main`** (no feature branches; no time). Pull before every commit. Branch `AAR` was merged (`16a46cd`) and deleted.
- [x] Next.js app scaffolded; uv Python project; EDA notebook complete
- [ ] Settle Open decisions above
- [ ] Teammate set up: repo, `npm install`, `uv sync`
- [x] Add approved packages (D23) (Claude, `448d61e`) — lightgbm, optuna, statsmodels, scikit-learn, xgboost; shap still to add
- [x] Ignore large generated data: `data/raw/bts/`, `data/processed/`, `data/models/` in `.gitignore` (Claude)

### 1. Data pipeline — delay side: Calvin · any-airport fetch: YXY4NG (D41)
- [ ] Load provided data (D30) and fetch external data by script (D7, D13)
- [x] Build prediction targets (D3, D9) (Calvin + Claude) — delay: `pipeline/build_delay.py`, 25,238 labelled flights
- [x] Convert flight times to UTC (D40) and join weather under the 3-hour rule (D4, D10) (Calvin + Claude) — delay: `pipeline/build_delay.py`, leakage asserts pass
- [x] Build features (D12), using crosswind/tailwind and excluding `wpgt_*` / `snow_*` (Calvin + Claude) — delay: `pipeline/build_delay.py`
- [ ] Leakage check
- [x] Accept any airport code (IATA/ICAO) (D13) — AAR side (YXY4NG, `a2aa764`); delay side (Calvin): `build_delay.py --airports KORD` builds ORD features; ATL/DFW stay the scored airports
- [ ] Cite all data sources
- [x] Hourly weather fetch for any airport code (D13, D39 A) (YXY4NG + Claude, `a2aa764`) — **interface for build_delay.py:** `from fetch_weather import resolve_airport, hourly_weather`; `resolve_airport("KORD")` → `{iata, icao, name, lat, lon, station, station_match, tz, runway_heading_deg, heading_source}`; `hourly_weather("ORD", "2023-01-01", "2025-07-31")` → DataFrame with exactly the provided weather file's columns and time format (+ `station`, `heading_source`). Runway heading: brief for ATL/DFW, else most common runway direction in OurAirports (assumption). Checked ATL, KDFW, ORD, KJFK; ATL/DFW reproduce the provided file 100%

### 2. Delay classifier (D16, D17) — Calvin (D41)
- [x] Baseline (D22) (Calvin + Claude) — `pipeline/train_delay.py`; test PR-AUC 0.157
- [x] Train RF, XGBoost, LightGBM with Optuna on PR-AUC (D20) using the split (D11) (Calvin + Claude) — Random Forest selected on validation (0.225); test PR-AUC 0.235
- [x] Threshold by max F1 on validation (D21) (Calvin + Claude) — risk ≥ 0.141
- [x] Report precision, recall, accuracy, confusion matrix vs baseline (Calvin + Claude) — `docs/EVALUATION.md`
- [x] Prediction explanations (D27) (Calvin + Claude) — exact TreeSHAP for all 43,260 test predictions; top 3 factors with observation times in `data/outputs/delay_flights.json`
- [x] Feature study on validation (Calvin + Claude) — `pipeline/feature_study_delay.py`: weather adds +16–18% PR-AUC; route / holiday / 3 h trend don't help consistently; features unchanged

### 3. AAR regressor (D5, D16, D18) — YXY4NG (D41)
Status: done end to end (15:06). Test RMSE (arrivals/h): baseline 11.29 · RF 8.88 · XGBoost 8.91 · **LightGBM 8.74** (selected on validation) · SARIMAX 7.51 (schedule-only comparison, D44).
- [x] BTS fetch (D7) (YXY4NG + Claude) — `pipeline/fetch_bts.py`; 31 monthly files, 3,255,141 flights touching ATL/DFW
- [x] AAR target and features (D8, D34, D42) (YXY4NG + Claude) — `pipeline/build_aar.py`; 45,264 airport-hours (ATL mean 37.5 arrivals/h, DFW 33.7): wheels-on per UTC hour; horizons 3/6/9/12 h; weather at issue time + 10 h window summaries incl. crosswind/tailwind; leakage assert; IATA/ICAO input
- [x] Baseline (D22) (YXY4NG + Claude) — in `pipeline/train_aar.py`, training period only
- [x] Train RF, XGBoost, LightGBM, SARIMAX with Optuna on RMSE (D20) using the split (D11) (YXY4NG + Claude) — `pipeline/train_aar.py`; all models learn from 2023 only; selection on validation (D44)
- [x] Report RMSE vs baseline (YXY4NG + Claude) — `data/outputs/aar_metrics.json` (overall, per airport, per horizon)
- [x] AAR failure case and limits (D28) (YXY4NG + Claude) — 5 cases in `aar_metrics.json`; e.g. ATL 19 Jul 2024 07:00–08:00 local (CrowdStrike outage): forecast ~72–82, actual 11–23
- [x] Merge branch `AAR` into `main` (`16a46cd`, before the first run); branch deleted
- [x] Review notes from Calvin's Claude — decided in D44; validation-based selection done in `3dd46f7`:
  - `train_aar.py` line 249 picks the best model by **test** RMSE; D20 tunes on validation, so selecting on validation keeps the test score unseen
  - SARIMAX has no weather input and is one model per airport (D34 lists weather features; D16 says each model covers both airports)
  - D23 row: "approved by a team member in chat" — which team member?

### 4. Pipeline → app contract — YXY4NG (D41)
- [x] Define contract (D24, D35) (YXY4NG + Claude) — approved in D35
- [x] Export predictions — AAR (`pipeline/export_aar.py`) and delay (Calvin) files in the D35 format; app reads both (`7563f54`)

### 5. App (Next.js) — YXY4NG (D41)
- [x] Views (D25): risk scores, AAR forecast, historical trends (rates), model performance (YXY4NG + Claude, `61566aa`); delay sections fill in when `delay_flights/metrics/trends.json` are exported
- [x] Recommendations (D26, D36) (YXY4NG + Claude) — rules R1–R4 approved and live in the app
- [x] Explanations / traceability in the UI (D27) (YXY4NG + Claude) — top-3 SHAP factors with observation timestamps per hour/flight
- [x] Uncertainty visible; the user makes the final call (YXY4NG + Claude) — 80% range per hour; recommendations labelled advisory

### 6. Claude in the app — YXY4NG (D41)
- [~] TMC briefing (D14) (YXY4NG + Claude) — `/api/briefing`: facts-only prompt, facts shown next to the text; needs `ANTHROPIC_API_KEY` on the server

### 7. Evaluation — each owner writes their model's results; Calvin assembles (D41)
- [ ] Results: baselines vs models (delays and AAR)
- [ ] Failure case with a reason, and how the user knows (D28)
- [ ] Run on dates/flights beyond the demo
- [ ] Impact: before/after vs baseline, measured vs estimated kept separate
- [ ] Realistic adoption constraints

### 8. Pitch and submission — Calvin (D41)
- [ ] TMC's current process and the cost of reacting late (problem realism)
- [ ] State assumptions; cite data sources
- [ ] First valid submission (D32)
- [ ] 3-minute pitch
- [ ] Final submission before 4:15 PM
