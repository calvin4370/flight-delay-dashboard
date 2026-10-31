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
| [ ] | Merge weather logs with flight delay records on time and airport | Brief: want to see | WS1 |
| [ ] | Delay risk classification (main target): flights facing a severe delay (> 45 min); `ARR_DELAY > 45` arrivals, `DEP_DELAY > 45` departures at ATL/DFW | Brief + update | D3, WS2 |
| [ ] | Report precision and recall, not only accuracy | Update | D21, WS2 |
| [ ] | AAR (optional bonus): hourly AAR forecast, measured by RMSE | Brief + update | D5, WS3 |
| [ ] | Interactive dashboard for ATC: risk scores, historical trends and recommendations | Brief: want to see | WS5 |
| [ ] | Scripts download and process public data with no manual steps | Brief: want to see | WS1 |
| [ ] | No leakage: only weather observed ≥ 3 h before the scheduled time; use the hourly file | Brief: avoid + update | D4, WS1 |
| [ ] | Use crosswind and tailwind components, not raw wind speed | Brief: avoid | WS1 |
| [ ] | Pipeline accepts any airport code (IATA or ICAO); demo and score on ATL and DFW | Brief: avoid + update | D13, WS1 |
| [ ] | Compare delay rates, not raw delay minutes, across airports | Brief: avoid + data guide | WS5 |
| [ ] | Ignore placeholder columns `wpgt_*` and `snow_*` | Update + data guide | WS1 |
| [ ] | External data only if public, cited and fetched by a script; no paid or private data | Update | WS1 |
| [ ] | State assumptions clearly in the demo | Update | WS8 |
| [ ] | Named user, current process, cost in time, money or risk | Rubric: problem realism | D6, WS8 |
| [ ] | Working end to end, tested beyond a scripted demo; LLM for reading/explanation, statistics/ML for detection | Rubric: technical soundness | WS1–7 |
| [ ] | Baseline, measured results, a visible failure case with a reason, and how the user knows | Rubric: honest evaluation | D22, D28, WS7 |
| [ ] | Claims traceable to timestamped signals or applied rules; uncertainty visible; human stays in control | Rubric: trust & traceability | D27, WS5 |
| [ ] | Before/after vs the baseline, measured vs estimated kept separate; realistic adoption constraints | Rubric: impact | WS7 |
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
| D23 | Packages approved: lightgbm, optuna, statsmodels, scikit-learn, shap | Calvin |
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

### Open

| # | Question |
|---|---|
| D32 | What counts as the first valid submission, and checkpoint times |
| D35 | JSON field definitions for each output file (D24); Claude drafts per D37 |
| D36 | The specific recommendation rules and their thresholds (D26); Claude drafts per D37 |
| D39 | Which public airport database (D13), and any package needed for the weather/airport fetch |

## Assumptions to state in the demo

- [ ] Runway headings ATL 80°, DFW 180° (brief)
- [ ] AAR proxy = realised arrival throughput from BTS, not the FAA's declared rate (D8)
- [ ] Weather observations only, no forecasts (D13)

---

## Workstreams

### 0. Setup and coordination
- [x] Next.js app scaffolded; uv Python project; EDA notebook complete
- [ ] Settle Open decisions above
- [ ] Teammate set up: repo, `npm install`, `uv sync`
- [ ] Add approved packages (D23)

### 1. Data pipeline
- [ ] Load provided data (D30) and fetch external data by script (D7, D13)
- [ ] Build prediction targets (D3, D9)
- [ ] Convert flight times to UTC (D40) and join weather under the 3-hour rule (D4, D10)
- [ ] Build features (D12), using crosswind/tailwind and excluding `wpgt_*` / `snow_*`
- [ ] Leakage check
- [ ] Accept any airport code (IATA/ICAO) (D13)
- [ ] Cite all data sources

### 2. Delay classifier (D16, D17)
- [ ] Baseline (D22)
- [ ] Train RF, XGBoost, LightGBM with Optuna on PR-AUC (D20) using the split (D11)
- [ ] Threshold by max F1 on validation (D21)
- [ ] Report precision, recall, accuracy, confusion matrix vs baseline
- [ ] Prediction explanations (D27)

### 3. AAR regressor (D5, D16, D18)
- [ ] BTS fetch and AAR target (D7, D8)
- [ ] Baseline (D22)
- [ ] Train RF, XGBoost, LightGBM, SARIMAX with Optuna on RMSE (D20) using the split (D11)
- [ ] Report RMSE vs baseline

### 4. Pipeline → app contract
- [ ] Define contract (D24, D35)
- [ ] Export predictions

### 5. App (Next.js)
- [ ] Views (D25): risk scores, AAR forecast, historical trends (rates), model performance
- [ ] Recommendations (D26, D36)
- [ ] Explanations / traceability in the UI (D27)
- [ ] Uncertainty visible; the user makes the final call

### 6. Claude in the app
- [ ] TMC briefing (D14)

### 7. Evaluation
- [ ] Results: baselines vs models (delays and AAR)
- [ ] Failure case with a reason, and how the user knows (D28)
- [ ] Run on dates/flights beyond the demo
- [ ] Impact: before/after vs baseline, measured vs estimated kept separate
- [ ] Realistic adoption constraints

### 8. Pitch and submission
- [ ] TMC's current process and the cost of reacting late (problem realism)
- [ ] State assumptions; cite data sources
- [ ] First valid submission (D32)
- [ ] 3-minute pitch
- [ ] Final submission before 4:15 PM
