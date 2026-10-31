"""Train and evaluate the severe-delay classifier (D16, D17, D20, D21, D22, D27) on the agreed split (D11).

Models: Random Forest, XGBoost, LightGBM (one model for both airports, both directions and all horizons),
each tuned with Optuna on validation PR-AUC. The best model is chosen on validation PR-AUC; its alert threshold
maximises F1 on validation. All models and the baseline learn from the training period only; test is scored once.
Baseline (D22): training-period severe rate for the same airport, direction, scheduled local hour and month.
Explanations (D27): per-prediction SHAP values (TreeSHAP) for the best model, with observation timestamps.

Usage: uv run python pipeline/train_delay.py [--trials 25] [--minutes-per-model 3]
Reads data/processed/delay_features.csv.gz (from build_delay.py).
Writes data/models/delay_*.joblib and data/outputs/delay_metrics.json, delay_test_predictions.csv,
delay_largest_misses.csv. Output formats are provisional until D35.
"""

import argparse
import json
import time
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import optuna
import pandas as pd
import shap
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score)

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ROOT / "data" / "processed" / "delay_features.csv.gz"
MODELS = ROOT / "data" / "models"
OUTPUTS = ROOT / "data" / "outputs"

SPLITS = {  # D11, on the scheduled local date
    "train": ("2023-01-01", "2023-12-31"),
    "validation": ("2024-01-01", "2024-06-30"),
    "test": ("2024-07-01", "2025-07-31"),
}
CATEGORICAL = ["airport", "direction", "carrier"]
SCHEDULE = ["distance", "local_hour", "day_of_week", "month", "horizon_h"]
BASELINE_KEYS = ["airport", "direction", "local_hour", "month"]
TOP_N = 5


# ---------------------------------------------------------------- data

def load() -> tuple[pd.DataFrame, list[str]]:
    df = pd.read_csv(FEATURES, parse_dates=["local_date", "sched_local", "sched_utc", "issue_utc"], low_memory=False)
    df["split"] = pd.NA
    for name, (lo, hi) in SPLITS.items():
        df.loc[(df["local_date"] >= lo) & (df["local_date"] <= hi), "split"] = name
    df = df[df["split"].notna()].reset_index(drop=True)
    df["severe"] = df["severe"].astype(int)
    for c in CATEGORICAL:  # same categories in every split
        df[c] = pd.Categorical(df[c], categories=sorted(df[c].dropna().unique()))
    weather = [c for c in df.columns if c.startswith(("wx_", "win_"))]
    return df, CATEGORICAL + SCHEDULE + weather


def as_codes(x: pd.DataFrame) -> pd.DataFrame:
    """Random Forest needs numbers: categories become integer codes."""
    return x.assign(**{c: x[c].cat.codes for c in CATEGORICAL})


# ---------------------------------------------------------------- models

def fit_rf(params, x, y):
    return RandomForestClassifier(n_jobs=-1, random_state=0, **params).fit(as_codes(x), y)


def fit_xgb(params, x, y):
    return xgb.XGBClassifier(enable_categorical=True, tree_method="hist", random_state=0, n_jobs=-1,
                             eval_metric="aucpr", **params).fit(x, y)


def fit_lgb(params, x, y):
    return lgb.LGBMClassifier(random_state=0, n_jobs=-1, verbose=-1, subsample_freq=1, **params).fit(x, y)


def proba(name, model, x) -> np.ndarray:
    return model.predict_proba(as_codes(x) if name == "random_forest" else x)[:, 1]


SPACES = {
    "random_forest": (fit_rf, lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 100, 400),
        "max_depth": t.suggest_int("max_depth", 4, 20),
        "min_samples_leaf": t.suggest_int("min_samples_leaf", 1, 50, log=True),
        "max_features": t.suggest_float("max_features", 0.2, 1.0),
        "class_weight": t.suggest_categorical("class_weight", [None, "balanced", "balanced_subsample"]),
    }),
    "xgboost": (fit_xgb, lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 100, 800),
        "learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "max_depth": t.suggest_int("max_depth", 2, 8),
        "subsample": t.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": t.suggest_float("colsample_bytree", 0.5, 1.0),
        "min_child_weight": t.suggest_float("min_child_weight", 1, 50, log=True),
        "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 10, log=True),
        "scale_pos_weight": t.suggest_float("scale_pos_weight", 1, 10, log=True),
    }),
    "lightgbm": (fit_lgb, lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 100, 800),
        "learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "num_leaves": t.suggest_int("num_leaves", 8, 128, log=True),
        "min_child_samples": t.suggest_int("min_child_samples", 10, 200, log=True),
        "subsample": t.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": t.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 10, log=True),
        "scale_pos_weight": t.suggest_float("scale_pos_weight", 1, 10, log=True),
    }),
}


def best_f1_threshold(y, p) -> float:
    prec, rec, thr = precision_recall_curve(y, p)
    f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-12)
    return float(thr[np.argmax(f1[:-1])])


def scores(y, p, threshold) -> dict:
    flag = (p >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, flag, labels=[0, 1]).ravel()
    return {"pr_auc": float(average_precision_score(y, p)), "threshold": threshold,
            "precision": float(precision_score(y, flag, zero_division=0)), "recall": float(recall_score(y, flag)),
            "f1": float(f1_score(y, flag)), "accuracy": float(accuracy_score(y, flag)),
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "positives": int(np.sum(y)), "rows": int(len(y))}


# ---------------------------------------------------------------- explanations

def shap_values(name, model, x) -> np.ndarray:
    """Per-prediction SHAP values (TreeSHAP), one column per feature."""
    if name == "xgboost":
        dm = xgb.DMatrix(x, enable_categorical=True)
        return model.get_booster().predict(dm, pred_contribs=True)[:, :-1]
    if name == "lightgbm":
        return model.booster_.predict(x, pred_contrib=True)[:, :-1]
    vals = shap.TreeExplainer(model).shap_values(as_codes(x), check_additivity=False)
    return vals[:, :, 1] if vals.ndim == 3 else vals


def observed_at(feature: str, issue: pd.Timestamp) -> str:
    if feature.startswith("wx_"):
        return f"observed {issue:%Y-%m-%d %H:%M} UTC"
    if feature.startswith("win_"):
        return f"window {issue - pd.Timedelta(hours=9):%Y-%m-%d %H:%M}-{issue:%H:%M} UTC"
    return "schedule"


def top_reasons(features, x: pd.DataFrame, sv: np.ndarray, issue: pd.Series) -> list[str]:
    order = np.argsort(-np.abs(sv), axis=1)[:, :TOP_N]
    out = []
    for i, idx in enumerate(order):
        parts = []
        for j in idx:
            f = features[j]
            parts.append(f"{f}={x.iat[i, j]} ({sv[i, j]:+.3f}; {observed_at(f, issue.iat[i])})")
        out.append(" | ".join(parts))
    return out


# ---------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--trials", type=int, default=25)
    p.add_argument("--minutes-per-model", type=float, default=3)
    args = p.parse_args()
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    MODELS.mkdir(parents=True, exist_ok=True)
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    started = time.time()

    df, features = load()
    part = {s: df[df["split"] == s] for s in SPLITS}
    x = {s: d[features] for s, d in part.items()}
    y = {s: d["severe"].to_numpy() for s, d in part.items()}
    print({s: (len(d), int(d["severe"].sum())) for s, d in part.items()}, flush=True)

    # Baseline (D22): training-period rates only; unseen combinations fall back to airport x direction, then overall.
    def baseline(apply_to: pd.DataFrame) -> np.ndarray:
        tr = part["train"]
        fine = tr.groupby(BASELINE_KEYS, observed=True)["severe"].mean().rename("fine")
        coarse = tr.groupby(["airport", "direction"], observed=True)["severe"].mean().rename("coarse")
        b = apply_to.join(fine, on=BASELINE_KEYS).join(coarse, on=["airport", "direction"])
        return b["fine"].fillna(b["coarse"]).fillna(tr["severe"].mean()).to_numpy()

    probs = {"validation": {"baseline": baseline(part["validation"])}, "test": {"baseline": baseline(part["test"])}}
    results = {}
    for name, (fit, space) in SPACES.items():
        def objective(t):
            m = fit(space(t), x["train"], y["train"])
            return average_precision_score(y["validation"], proba(name, m, x["validation"]))

        study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))
        study.optimize(objective, n_trials=args.trials, timeout=int(args.minutes_per_model * 60))
        model = fit(study.best_params, x["train"], y["train"])  # trained on the training period only (D11)
        joblib.dump(model, MODELS / f"delay_{name}.joblib")
        probs["validation"][name] = proba(name, model, x["validation"])
        probs["test"][name] = proba(name, model, x["test"])
        results[name] = {"model": model, "best_params": study.best_params, "trials": len(study.trials)}
        print(f"{name}: validation PR-AUC {study.best_value:.4f} after {len(study.trials)} trials", flush=True)

    models = ["baseline", *results]
    thresholds = {m: best_f1_threshold(y["validation"], probs["validation"][m]) for m in models}
    val_pr_auc = {m: float(average_precision_score(y["validation"], probs["validation"][m])) for m in models}
    best = max(results, key=lambda m: val_pr_auc[m])  # chosen on validation, never on test

    test = part["test"].copy()
    metrics = {
        "target": "severe = DEP_DELAY > 45 (departures) / ARR_DELAY > 45 (arrivals) at ATL/DFW (D3)",
        "split": SPLITS, "best_model": best, "selected_on": "validation PR-AUC",
        "threshold_rule": "max F1 on validation (D21)",
        "validation_pr_auc": val_pr_auc, "thresholds": thresholds,
        "best_params": {m: r["best_params"] for m, r in results.items()},
        "trials": {m: r["trials"] for m, r in results.items()},
        "test": {m: scores(y["test"], probs["test"][m], thresholds[m]) for m in models},
        "test_by_horizon": {}, "test_by_airport_direction": {},
    }
    for key_cols, bucket in [(["horizon_h"], "test_by_horizon"), (["airport", "direction"], "test_by_airport_direction")]:
        for key, g in test.groupby(key_cols, observed=True):
            idx = test.index.get_indexer(g.index)
            label = " ".join(str(k) for k in (key if isinstance(key, tuple) else (key,)))
            metrics[bucket][label] = {m: scores(y["test"][idx], probs["test"][m][idx], thresholds[m])
                                      for m in ["baseline", best]}

    # Explanations (D27) for the best model on every test row.
    sv = shap_values(best, results[best]["model"], x["test"])
    test["probability"] = probs["test"][best]
    test["flag"] = (test["probability"] >= thresholds[best]).astype(int)
    test["baseline_probability"] = probs["test"]["baseline"]
    test["reasons"] = top_reasons(features, x["test"], sv, test["issue_utc"])
    cols = ["target_id", "airport", "direction", "carrier", "ORIGIN", "DEST", "OP_CARRIER_FL_NUM", "sched_local",
            "sched_utc", "horizon_h", "issue_utc", "delay_min", "severe", "probability", "flag",
            "baseline_probability", "reasons"]
    test[cols].to_csv(OUTPUTS / "delay_test_predictions.csv", index=False)

    # Failure-case candidates (D28): biggest misses at the 3 h horizon.
    h3 = test[test["horizon_h"] == 3]
    missed = h3[(h3["severe"] == 1) & (h3["flag"] == 0)].nsmallest(15, "probability").assign(miss="missed severe")
    false_alarm = h3[(h3["severe"] == 0) & (h3["flag"] == 1)].nlargest(15, "probability").assign(miss="false alarm")
    pd.concat([missed, false_alarm])[["miss", *cols]].to_csv(OUTPUTS / "delay_largest_misses.csv", index=False)

    importance = pd.Series(np.abs(sv).mean(axis=0), index=features).sort_values(ascending=False)
    metrics["mean_abs_shap_top15"] = importance.head(15).round(4).to_dict()
    metrics["runtime_minutes"] = round((time.time() - started) / 60, 1)
    (OUTPUTS / "delay_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))

    summary = pd.DataFrame({m: {k: v for k, v in metrics["test"][m].items() if k != "confusion_matrix"}
                            for m in models}).T
    print(f"\nbest model (validation PR-AUC): {best}")
    print(summary[["pr_auc", "threshold", "precision", "recall", "f1", "accuracy", "positives", "rows"]].round(3).to_string())
    print("\nconfusion matrix (test, best model):", metrics["test"][best]["confusion_matrix"])
    print("baseline confusion matrix (test):", metrics["test"]["baseline"]["confusion_matrix"])
    print(f"runtime: {metrics['runtime_minutes']} min")


if __name__ == "__main__":
    main()
