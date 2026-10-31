# Project instructions

Team project for Autonomous SG 2026, Airbus Challenge 5 (airport weather and delay risk).

- **Read the plan first:** `PLAN.md` is the single source of truth for tasks and decisions. Follow its "How to use this file" rules: claim a task (`[~]` + name) before starting, tick it (`[x]`) when done, and add new tasks under the right workstream.
- **Decisions are made by humans.** Propose options and ask; only a team member marks a decision *Decided*. Don't build on anything *Proposed* or *Open* in `PLAN.md`.
- **Git:** humans run all git commands. Suggest commit messages, but never commit, push, pull, merge or switch branches yourself (D31).
- **Packages:** ask before adding any package (D31). Already approved: lightgbm, optuna, statsmodels, scikit-learn, shap.
- Data lives in `data/raw/`; problem statements in `docs/problem_statements/`; EDA in `notebooks/eda.ipynb`.
- Python: uv project at the repo root (`uv sync`, `uv run ...`).

@PLAN.md
@AGENTS.md
