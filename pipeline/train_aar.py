"""Train and evaluate the hourly AAR regressor (D16, D18, D20, D22, D34) on the agreed split (D11).

Models: Random Forest, XGBoost, LightGBM (one model for both airports and all horizons), tuned with Optuna on
validation RMSE; SARIMAX (one per airport, scheduled arrivals as exogenous input) with h-step-ahead forecasts.
All models and the baseline learn from the training period only; validation is for tuning, test is scored once.
Baseline: mean arrivals in the training period for the same airport, local hour, day of week and month.

Usage: uv run python pipeline/train_aar.py [--trials 20] [--minutes-per-model 4]
Reads data/processed/aar_features.csv.gz and aar_hourly.csv.gz.
Writes data/models/aar_*.joblib, data/outputs/aar_metrics.json, and data/processed/aar_test_predictions.csv +
aar_largest_errors.csv (intermediate, read by export_aar.py).
"""

import argparse
import json
import time
import warnings
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import optuna
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
MODELS = ROOT / "data" / "models"
OUTPUTS = ROOT / "data" / "outputs"

TARGET = "arrivals"
SPLITS = {  # D11, on the airport's local date
    "train": ("2023-01-01", "2023-12-31"),
    "validation": ("2024-01-01", "2024-06-30"),
    "test": ("2024-07-01", "2025-07-31"),
}
BASELINE_KEYS = ["airport", "local_hour", "day_of_week", "month"]


def rmse(y, p) -> float:
    return float(np.sqrt(np.mean((np.asarray(y) - np.asarray(p)) ** 2)))


def split_of(dates: pd.Series) -> pd.Series:
    out = pd.Series(pd.NA, index=dates.index, dtype="string")
    for name, (lo, hi) in SPLITS.items():
        out[(dates >= lo) & (dates <= hi)] = name
    return out


def feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    x = df.drop(columns=[TARGET, "time_utc", "issue_utc", "local_date", "split"])
    x["airport"] = x["airport"].astype("category")
    return x


# ---------------------------------------------------------------- tree models

def tune(name: str, objective, trials: int, seconds: int) -> optuna.Study:
    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=0))
    study.optimize(objective, n_trials=trials, timeout=seconds)
    print(f"{name}: best validation RMSE {study.best_value:.3f} after {len(study.trials)} trials", flush=True)
    return study


def fit_rf(params, x, y):
    x = x.assign(airport=x["airport"].cat.codes)
    return RandomForestRegressor(n_jobs=-1, random_state=0, **params).fit(x, y)


def predict_rf(model, x):
    return model.predict(x.assign(airport=x["airport"].cat.codes))


def fit_xgb(params, x, y):
    return xgb.XGBRegressor(enable_categorical=True, tree_method="hist", random_state=0, n_jobs=-1, **params).fit(x, y)


def fit_lgb(params, x, y):
    return lgb.LGBMRegressor(random_state=0, n_jobs=-1, verbose=-1, **params).fit(x, y)


SPACES = {
    "random_forest": (fit_rf, predict_rf, lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 100, 400),
        "max_depth": t.suggest_int("max_depth", 6, 24),
        "min_samples_leaf": t.suggest_int("min_samples_leaf", 1, 20),
        "max_features": t.suggest_float("max_features", 0.3, 1.0),
    }),
    "xgboost": (fit_xgb, lambda m, x: m.predict(x), lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 200, 1200),
        "learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "max_depth": t.suggest_int("max_depth", 3, 10),
        "subsample": t.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": t.suggest_float("colsample_bytree", 0.5, 1.0),
        "min_child_weight": t.suggest_float("min_child_weight", 1, 20, log=True),
        "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 10, log=True),
    }),
    "lightgbm": (fit_lgb, lambda m, x: m.predict(x), lambda t: {
        "n_estimators": t.suggest_int("n_estimators", 200, 1200),
        "learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "num_leaves": t.suggest_int("num_leaves", 15, 255, log=True),
        "min_child_samples": t.suggest_int("min_child_samples", 5, 100, log=True),
        "subsample": t.suggest_float("subsample", 0.6, 1.0),
        "subsample_freq": 1,
        "colsample_bytree": t.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 10, log=True),
    }),
}


def train_trees(data: dict, trials: int, seconds: int) -> dict:
    results = {}
    for name, (fit, predict, space) in SPACES.items():
        def objective(t):
            model = fit(space(t), data["x_train"], data["y_train"])
            return rmse(data["y_val"], predict(model, data["x_val"]))

        study = tune(name, objective, trials, seconds)
        # Final model: tuned settings, trained on the training period only (D11), scored once on test.
        model = fit(study.best_params | ({"subsample_freq": 1} if name == "lightgbm" else {}),
                    data["x_train"], data["y_train"])
        joblib.dump(model, MODELS / f"aar_{name}.joblib")
        results[name] = {"model": model, "predict": predict, "best_params": study.best_params,
                         "validation_rmse": study.best_value, "trials": len(study.trials),
                         "validation_pred": predict(model, data["x_val"])}
    return results


# ---------------------------------------------------------------- SARIMAX

def sarimax_forecasts(series: pd.DataFrame, order, seasonal_order, fit_end: str) -> tuple[dict, object]:
    """Fit on hours up to fit_end, then h-step-ahead forecasts for every hour and horizon.

    With the fitted parameters applied to the full series, the Kalman-filtered state at hour t gives the
    forecast for t + h as  x[t+h] * beta + Z T^h a[t|t]  (scheduled arrivals are known in advance).
    """
    y = series[TARGET].astype(float).to_numpy()
    exog = np.column_stack([np.ones(len(series)), series["scheduled_arrivals"].to_numpy(float)])
    n_fit = int((series["local_date"] <= fit_end).sum())
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = SARIMAX(y[:n_fit], exog=exog[:n_fit], order=order, seasonal_order=seasonal_order,
                      trend="n").fit(disp=False, maxiter=50)
        full = res.apply(y, exog=exog)
    beta = full.params[:exog.shape[1]]
    z = full.model["design"][:, :, 0] if full.model["design"].ndim == 3 else full.model["design"]
    t_mat = full.model["transition"][:, :, 0] if full.model["transition"].ndim == 3 else full.model["transition"]
    states = full.filtered_state  # (k_states, n)
    out = {}
    for h in [3, 6, 9, 12]:
        err = (z @ np.linalg.matrix_power(t_mat, h) @ states).ravel()  # error forecast made at t for t + h
        pred = np.full(len(y), np.nan)
        pred[h:] = exog[h:] @ beta + err[:-h]
        out[h] = pred
    return out, res


def train_sarimax(hourly: pd.DataFrame, trials: int, seconds: int) -> dict:
    hourly = hourly.assign(split=split_of(hourly["local_date"]))
    per_airport = {a: g.reset_index(drop=True) for a, g in hourly.groupby("airport")}

    def val_rmse(order, seasonal):
        errs = []
        for g in per_airport.values():
            preds, _ = sarimax_forecasts(g, order, seasonal, SPLITS["train"][1])
            val = g["split"].eq("validation").fillna(False).to_numpy(dtype=bool)  # hours before 2023 have no split
            for p in preds.values():
                errs.append((g.loc[val, TARGET].to_numpy() - p[val]) ** 2)
        return float(np.sqrt(np.mean(np.concatenate(errs))))

    def objective(t):
        order = (t.suggest_int("p", 0, 2), 0, t.suggest_int("q", 0, 2))
        seasonal = (t.suggest_int("P", 0, 1), 0, t.suggest_int("Q", 0, 1), 24)
        return val_rmse(order, seasonal)

    study = tune("sarimax", objective, trials, seconds)
    bp = study.best_params
    order, seasonal = (bp["p"], 0, bp["q"]), (bp["P"], 0, bp["Q"], 24)
    preds = {}
    for a, g in per_airport.items():
        # Parameters fitted on the training period only (D11); forecasts run through the test period.
        p, res = sarimax_forecasts(g, order, seasonal, SPLITS["train"][1])
        joblib.dump(res.params, MODELS / f"aar_sarimax_{a}_params.joblib")
        preds[a] = pd.DataFrame({"time_utc": g["time_utc"], **{f"h{h}": v for h, v in p.items()}})
    return {"best_params": {"order": order, "seasonal_order": seasonal}, "validation_rmse": study.best_value,
            "trials": len(study.trials), "predictions": preds}


# ---------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--trials", type=int, default=20)
    p.add_argument("--minutes-per-model", type=float, default=4)
    args = p.parse_args()
    seconds = int(args.minutes_per_model * 60)
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    MODELS.mkdir(parents=True, exist_ok=True)
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    started = time.time()

    feats = pd.read_csv(PROC / "aar_features.csv.gz", parse_dates=["time_utc", "issue_utc", "local_date"])
    hourly = pd.read_csv(PROC / "aar_hourly.csv.gz", parse_dates=["time_utc", "local_date"])
    feats["split"] = split_of(feats["local_date"])
    feats = feats[feats["split"].notna()].reset_index(drop=True)
    parts = {s: feats[feats["split"] == s] for s in SPLITS}
    data = {"x_train": feature_matrix(parts["train"]), "y_train": parts["train"][TARGET],
            "x_val": feature_matrix(parts["validation"]), "y_val": parts["validation"][TARGET]}
    print({s: len(d) for s, d in parts.items()}, flush=True)

    # Baseline (D22): computed from the training period only.
    def baseline(fit_on: pd.DataFrame, apply_to: pd.DataFrame) -> np.ndarray:
        means = fit_on.groupby(BASELINE_KEYS)[TARGET].mean().rename("b")
        b = apply_to.join(means, on=BASELINE_KEYS)["b"]
        return b.fillna(fit_on[TARGET].mean()).to_numpy()

    test = parts["test"].copy()
    test["baseline"] = baseline(parts["train"], test)
    val_baseline = rmse(parts["validation"][TARGET], baseline(parts["train"], parts["validation"]))

    trees = train_trees(data, args.trials, seconds)
    x_test = feature_matrix(test.drop(columns=["baseline"]))
    for name, r in trees.items():
        test[name] = r["predict"](r["model"], x_test)

    sar = train_sarimax(hourly, max(4, args.trials // 3), seconds)
    sar_long = pd.concat([d.assign(airport=a).melt(id_vars=["time_utc", "airport"], var_name="h", value_name="sarimax")
                          for a, d in sar["predictions"].items()])
    sar_long["horizon_h"] = sar_long["h"].str[1:].astype(int)
    test = test.merge(sar_long.drop(columns="h"), on=["time_utc", "airport", "horizon_h"], how="left")

    models = ["baseline", *trees, "sarimax"]
    metrics = {"target": "AAR proxy: realised arrivals (wheels-on) per airport per UTC hour (D8)",
               "split": SPLITS, "validation_rmse": {"baseline": val_baseline,
                                                    **{k: v["validation_rmse"] for k, v in trees.items()},
                                                    "sarimax": sar["validation_rmse"]},
               "best_params": {**{k: v["best_params"] for k, v in trees.items()}, "sarimax": sar["best_params"]},
               "test_rmse": {}, "test_mae": {}, "test_rows": int(len(test))}
    for group_keys, label in [([], "all"), (["airport"], None), (["airport", "horizon_h"], None)]:
        groups = [((), test)] if not group_keys else test.groupby(group_keys)
        for key, g in groups:
            k = label or " ".join(str(v) for v in (key if isinstance(key, tuple) else (key,)))
            if group_keys == ["airport", "horizon_h"]:
                k = f"{key[0]} h{key[1]}"
            metrics["test_rmse"][k] = {m: rmse(g[TARGET], g[m]) for m in models}
            metrics["test_mae"][k] = {m: float(np.mean(np.abs(g[TARGET] - g[m]))) for m in models}
    # Model selection on validation RMSE (D20); the test score stays unseen until here.
    best = min(trees, key=lambda m: trees[m]["validation_rmse"])
    metrics["best_model"] = best
    metrics["selected_on"] = "validation"
    # 80% range per horizon from the selected model's validation errors (actual - predicted).
    val_err = parts["validation"][TARGET].to_numpy() - trees[best]["validation_pred"]
    by_h = pd.Series(val_err).groupby(parts["validation"]["horizon_h"].to_numpy())
    metrics["interval_80_by_horizon"] = {int(h): {"low": float(e.quantile(0.1)), "high": float(e.quantile(0.9))}
                                         for h, e in by_h}
    metrics["runtime_minutes"] = round((time.time() - started) / 60, 1)

    # Largest errors of the best model at the 3 h horizon: candidates for the failure case (D28).
    cols = ["airport", "time_utc", "local_hour", "horizon_h", TARGET, "scheduled_arrivals", "baseline", best,
            "wx_condition_code", "wx_precip_mm", "win_any_severe_wx", "win_any_thunder", "win_max_wind",
            "win_max_crosswind", "win_max_tailwind"]
    h3 = test[test["horizon_h"] == 3].assign(error=lambda d: d[best] - d[TARGET])
    h3.reindex(h3["error"].abs().sort_values(ascending=False).index)[cols + ["error"]].head(30).to_csv(
        PROC / "aar_largest_errors.csv", index=False)
    test[["airport", "time_utc", "local_hour", "horizon_h", TARGET, "scheduled_arrivals", *models]].to_csv(
        PROC / "aar_test_predictions.csv", index=False)
    (OUTPUTS / "aar_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))

    print(json.dumps({"validation_rmse": metrics["validation_rmse"], "test_rmse_all": metrics["test_rmse"]["all"],
                      "best_model": best, "runtime_minutes": metrics["runtime_minutes"]}, indent=2))
    print(pd.DataFrame(metrics["test_rmse"]).T.round(3).to_string())


if __name__ == "__main__":
    main()
