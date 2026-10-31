# Team Plan: Airbus Challenge 5

**Predictive Airport Capacity & Risk Model** for ATL and DFW: warn 3–12 h ahead which flights face a severe delay (> 45 min), and forecast hourly arrival rate (AAR, bonus).

**Submissions close 4:15 PM.** Time discipline (5%) is scored on the **first valid submission**, and resubmitting does not reset it.

Sources: `docs/problem_statements/` (updated brief + summary of updates), `data/raw/challenge5_data_guide.xlsx`, EDA in `notebooks/eda.ipynb` (see its Summary).

---

## How to use this file (humans and Claude Code)

- This is the **single source of truth** for tasks and decisions. Read it before starting work.
- Task states: `- [ ]` to do · `- [~]` in progress · `- [x]` done. Add an owner and short note: `- [~] Task (name + Claude) — note`.
- **Claim a task before starting it** (mark `[~]` with your name) so two people don't do the same thing.
- **Add tasks** under the right workstream as you discover them. Don't delete other people's tasks; mark them done or strike them out with a reason.
- **Decisions are made by humans.** Claude may propose options, but only a team member moves a decision to *Decided*, with their name.
- Don't build on anything that depends on an *Open* or *Proposed* decision until it is decided.
- Keep entries short. Put details in code, notebooks or commit messages.

---

## Rubric (from the brief)

| Criterion | Weight | What judges look for |
|---|---|---|
| Problem realism | 20% | Named user, current process, cost in time, money or risk |
| Technical soundness | 25% | Working end to end; LLMs for reading and explanation; solvers, rules or statistics for detection |
| Honest evaluation | 20% | Metrics, test data, a baseline, a visible failure with a reason |
| Trust & traceability | 20% | Claims traceable to timestamped signals or applied rules; uncertainty visible; human in control |
| Impact | 10% | Credible before/after vs the baseline; measured vs estimated |
| Time discipline | 5% | Early first valid submission; focused pitch under 3 minutes |

---

## Brief requirements

Every requirement from the updated brief (Challenge #5), the Summary of Updates and the rubric. Tick when the build meets it.

| ✓ | Requirement | Source | Covered by |
|---|---|---|---|
| [ ] | Merge weather logs with flight delay records on time and airport | Brief: want to see | WS1 |
| [ ] | Delay risk classification (main target): flights facing a severe delay (> 45 min); `ARR_DELAY > 45` arrivals, `DEP_DELAY > 45` departures at ATL/DFW | Brief + update | D3, WS2 |
| [ ] | Report precision and recall, not only accuracy (~10% of flights positive) | Update | D21, WS2, WS7 |
| [ ] | AAR (optional bonus): hourly AAR forecast, measured by RMSE | Brief + update | D5, D20, WS3 |
| [ ] | Interactive dashboard for ATC: **risk scores**, **historical trends** and **recommendations** | Brief: want to see | WS5 (D25, D26) |
| [ ] | Scripts download and process public data with no manual steps | Brief: want to see | WS1 (D30, D7) |
| [ ] | No leakage: only weather observed ≥ 3 h before the scheduled time; use the hourly file | Brief: avoid + update | D4, WS1 |
| [ ] | Use crosswind and tailwind components, not raw wind speed alone | Brief: avoid | WS1 features (D12) |
| [ ] | Pipeline accepts any airport code (IATA or ICAO); demo and score on ATL and DFW | Brief: avoid + update | WS1 |
| [ ] | Compare delay rates (share of flights), not raw delay minutes, across airports | Brief: avoid + data guide | WS5 trends, WS7 |
| [ ] | Ignore placeholder columns `wpgt_*` and `snow_*` | Update + data guide | WS1 features (D12) |
| [ ] | External data only if public, cited and fetched by a script; no paid or private data | Update | WS1 sources list |
| [ ] | State assumptions clearly in the demo | Update | Assumptions section, WS8 |
| [ ] | Named user, current process, cost in time, money or risk | Rubric: problem realism | D6, WS8 |
| [ ] | Working end to end; LLM for reading/explanation, statistics/ML for detection | Rubric: technical soundness | WS1–6 (D14) |
| [ ] | Baseline, measured results, visible failure case with reason; label data limits | Rubric: honest evaluation | D22, D28, WS7 |
| [ ] | Claims traceable to timestamped signals or applied rules; **uncertainty visible**; **human stays in control** | Rubric: trust & traceability | D27, WS5, WS6 |
| [ ] | **Before/after vs today's process**, measured vs estimated kept separate | Rubric: impact | WS7 |
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
| D16 | Two models: one delay classifier and one AAR regressor, each covering both airports and all horizons | Calvin |
| D17 | Delay classifier candidates: Random Forest, XGBoost, LightGBM | Calvin |
| D18 | AAR regressor candidates: Random Forest, XGBoost, LightGBM, SARIMAX | Calvin |
| D19 | No LSTM | Calvin |
| D20 | Hyperparameter tuning with Optuna; tune delays on **PR-AUC**, AAR on **RMSE** | Calvin |
| D21 | Delay alert threshold: maximise F1 on the validation period; report precision, recall, accuracy and confusion matrix at that threshold | Calvin |
| D22 | Baselines: delays = historical severe rate for the same airport, direction, hour and month; AAR = historical average arrivals for the same airport, hour, day of week and month | Calvin |
| D23 | Packages approved for model work: lightgbm, optuna, statsmodels, scikit-learn | Calvin |
| D6 | User: ATL/DFW Traffic Management Coordinator (FAA Traffic Management Unit) | Calvin |
| D7 | AAR data: full BTS On-Time monthly files, Jan 2023–Jul 2025 (~0.9 GB), fetched by script | Calvin |
| D33 | Plan structure: usage rules above and workstreams 0–8 below | Calvin |
| D9 | Cancelled / diverted flights count as **severe** in the delay label (stated as an assumption) | Calvin |
| D10 | Delay classifier horizons: 3, 6, 9, 12 h as an input; each row repeated per horizon with only the weather allowed at that horizon; app shows risk at each horizon | Calvin |
| D11 | Time split: train 2023 · validate Jan–Jun 2024 (Optuna + threshold) · test Jul 2024–Jul 2025 | Calvin |
| D8 | AAR target: actual arrivals (wheels-on) per airport per UTC hour from BTS, stated as "AAR proxy = realised arrival throughput" | Calvin |
| D34 | AAR regressor mirrors the delay model: horizons 3/6/9/12 h as an input; features = scheduled arrivals that hour + calendar (hour, day of week, month) + weather lookbacks incl. crosswind/tailwind + 3–12 h window summaries; same D11 split | Calvin |
| D15 | Folders: `pipeline/` (Python: fetch, build, train, evaluate, export); `data/raw` (inputs), `data/processed` (features), `data/models`, `data/outputs` (predictions + metrics); app stays in `src/` | Calvin |
| D30 | Provided files are expected locally in `data/raw/` (script explains how to get them); only public external data (BTS) is downloaded by script | Calvin |
| D13 | No external data beyond BTS; the observation-only limit is stated | Calvin |
| D14 | Claude writes a TMC shift briefing from model outputs (at-risk hours/flights and why, citing timestamped weather signals); never invents numbers; says so when data is missing | Calvin |
| D24 | Contract: pipeline writes JSON to `data/outputs/` (flight risks, hourly AAR forecasts, metrics, trends); the Next.js app reads it directly | Calvin |
| D25 | App views: Risk board (flights/hours with risk at 3/6/9/12 h + evidence), AAR forecast (vs baseline, next 3–12 h), Historical trends (rates, not minutes), Model performance (precision/recall/confusion matrix, RMSE vs baselines, failure case) | Calvin |
| D26 | Recommendations: fixed rules on model outputs (each shows the rule that fired); Claude only words them in the briefing | Calvin |
| D27 | Explanations: SHAP per prediction (top features with values and observation timestamps); `shap` package approved with this choice | Calvin |
| D28 | Failure case(s) picked from test-set results (Jul 2024–Jul 2025) after evaluation, with a reason | Calvin |
| D29 | No reference wind limits; crosswind/tailwind are model inputs only | Calvin |
| D31 | Rules for every Claude Code session (in `CLAUDE.md`): humans run all git commands; ask before adding packages | Calvin |
| D37 | D35 and D36 are drafted by Claude as *Proposed* when the work starts, and approved by a team member before anything is built on them | Calvin |
| D38 | Assumptions list below and `CLAUDE.md` approved | Calvin |
| D12 | Delay classifier features: schedule (airport, direction, hour, day of week, month, carrier, distance) + weather at 3/6/9/12 h lookbacks incl. crosswind/tailwind + 3–12 h window summaries (max precip, any rain/severe/thunder, max wind/crosswind/tailwind, pressure change) | Calvin |

### Proposed (need a team member to confirm)

| # | Proposal | From |
|---|---|---|
| — | none | — |

### Open

| # | Question |
|---|---|
| D35 | JSON field definitions for each output file (under D24); Claude drafts per D37 |
| D36 | The specific recommendation rules and their thresholds (under D26); Claude drafts per D37 |
| D32 | What counts as the first valid submission, and checkpoint times (decide later) |

## Assumptions to state in the demo

- [ ] Flights file weather is ~4–6 h older than the flight (EDA D2), so it is not used as "weather at flight time"
- [ ] Fixed runway headings ATL 80°, DFW 180° (brief); real airports switch direction
- [ ] Cancelled / diverted flights are counted as severe (D9)
- [ ] AAR proxy = realised arrival throughput from BTS, not the FAA's declared rate (D8)
- [ ] Weather observations only (no forecasts): catches only part of severe weather 3–12 h ahead (D13, EDA G3)
- [ ] Add more as decisions are made

---

## Workstreams

### 0. Setup and coordination
- [x] Next.js app scaffolded; uv Python project; EDA notebook complete
- [ ] Settle Proposed / Open decisions above
- [ ] Teammate set up: repo, `npm install`, `uv sync`, data files in `data/raw/`
- [ ] Add approved model packages (D23)

### 1. Data pipeline
- [ ] Fetch / load data by script (D30, D7)
- [ ] Build prediction targets (D3, D9)
- [ ] Join weather under the 3-hour rule (D4, D10)
- [ ] Build features (D12), including crosswind/tailwind components and excluding `wpgt_*` / `snow_*` (brief)
- [ ] Leakage check
- [ ] Accept any airport code (IATA/ICAO)
- [ ] Data sources list with citations

### 2. Delay classifier (D16, D17)
- [ ] Baseline (D22)
- [ ] Train RF, XGBoost, LightGBM with Optuna on PR-AUC (D20) using the agreed split (D11)
- [ ] Threshold by max F1 on validation (D21)
- [ ] Report precision, recall, accuracy, confusion matrix vs baseline, per airport and direction
- [ ] Prediction explanations (D27)
- [ ] Failure case (D28)

### 3. AAR regressor (D5, D16, D18)
- [ ] AAR data pipeline (D7)
- [ ] AAR target (D8)
- [ ] Baseline (D22)
- [ ] Train RF, XGBoost, LightGBM, SARIMAX with Optuna on RMSE (D20) using the agreed split (D11)
- [ ] Report RMSE vs baseline, per airport
- [ ] Failure case and limits

### 4. Pipeline → app contract
- [ ] Define contract (D24)
- [ ] Export predictions for the demo

### 5. App (Next.js)
- [ ] Views (D25)
- [ ] Risk scores (brief)
- [ ] Historical trends, as rates not raw minutes (brief)
- [ ] Recommendations (D26)
- [ ] Explanations / traceability in the UI (D27)
- [ ] Uncertainty visible; the user makes the final call (rubric)

### 6. Claude in the app
- [ ] Role and guardrails (D14)

### 7. Evaluation write-up
- [ ] Results: baselines vs models (delays and AAR)
- [ ] Failure case with reason and what would fix it
- [ ] Limits from the EDA
- [ ] Impact: before/after vs today's process, measured vs estimated kept separate (rubric)

### 8. Pitch and submission
- [ ] First valid submission (D32)
- [ ] README: problem, user, how to run, data sources with citations, assumptions, results
- [ ] 3-minute demo script
- [ ] Final submission before 4:15 PM

---

## Checkpoints

To be set by the team (D32).
