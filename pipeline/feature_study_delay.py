"""Feature study for the delay classifier, judged on validation PR-AUC only (the test year is never used here).

Variants, for each algorithm with its own tuned settings from data/models/delay_*.joblib, trained on 2023:
  schedule only            -> D12 schedule features, no weather (ablation)
  current (D12 + D42)      -> the model as built
  + route                  -> the other airport (origin for arrivals, destination for departures)
  + holiday                -> days to the nearest US federal holiday (pandas calendar)
  + 3 h trend              -> rain / heaviest rain / pressure change in the last 3 h before the issue time
  + all three

Usage: uv run python pipeline/feature_study_delay.py
Writes data/outputs/delay_feature_study.json.
"""

import json
import sys
from pathlib import Path

import joblib
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
import numpy as np
import pandas as pd
from pandas.tseries.holiday import USFederalHolidayCalendar
from sklearn.metrics import average_precision_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_delay as T

ROOT = Path(__file__).resolve().parent.parent
WEATHER = ROOT / "data" / "raw" / "challenge5_hourly_weather_ATL_DFW.csv"
OUT = ROOT / "data" / "outputs" / "delay_feature_study.json"
SEEDS = [0, 1, 2]


def add_extras(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    # Route: the airport at the other end of the flight.
    other = np.where(df["direction"] == "arrival", df["ORIGIN"], df["DEST"])
    df["other_airport"] = pd.Categorical(other, categories=sorted(pd.unique(other)))
    # Holiday: days to the nearest US federal holiday (known well in advance).
    hol = USFederalHolidayCalendar().holidays("2022-11-01", "2025-12-31").to_numpy()
    days = df["local_date"].to_numpy()[:, None] - hol[None, :]
    df["days_to_holiday"] = np.min(np.abs(days.astype("timedelta64[D]").astype(int)), axis=1).clip(max=14)
    # Short-term trend: last 3 hours ending at the issue time (never newer than the horizon).
    w = pd.read_csv(WEATHER, parse_dates=["time_utc"])
    parts = []
    for a, g in w.groupby("airport"):
        g = g.set_index("time_utc").sort_index()
        parts.append(pd.DataFrame({
            "airport": a,
            "trend3_max_precip": g["precip_mm"].rolling(3, min_periods=1).max(),
            "trend3_any_rain": (g["precip_mm"] > 0).astype(float).rolling(3, min_periods=1).max(),
            "trend3_pressure_change": g["pressure_hpa"] - g["pressure_hpa"].shift(2),
        }).rename_axis("issue_utc").reset_index())
    trend = pd.concat(parts)
    trend["airport"] = pd.Categorical(trend["airport"], categories=df["airport"].cat.categories)
    return df.merge(trend, on=["airport", "issue_utc"], how="left")


def main() -> None:
    df, base_features = T.load()
    df = add_extras(df)
    weather = [c for c in base_features if c.startswith(("wx_", "win_"))]
    schedule = [c for c in base_features if c not in weather]
    route, holiday = ["other_airport"], ["days_to_holiday"]
    trend = ["trend3_max_precip", "trend3_any_rain", "trend3_pressure_change"]
    variants = {
        "schedule only (no weather)": schedule,
        "current (D12 + D42)": base_features,
        "+ route": base_features + route,
        "+ holiday": base_features + holiday,
        "+ 3 h trend": base_features + trend,
        "+ route + holiday + 3 h trend": base_features + route + holiday + trend,
    }
    tr, va = df[df["split"] == "train"], df[df["split"] == "validation"]
    results = {}
    for model_name in ["lightgbm", "xgboost", "random_forest"]:
        params = joblib.load(ROOT / "data" / "models" / f"delay_{model_name}.joblib").get_params()
        params.pop("random_state", None)
        seeds = SEEDS if model_name != "random_forest" else SEEDS[:1]  # forest is slow; its seed noise is small
        for name, feats in variants.items():
            scores = []
            for seed in seeds:
                p = {**params, "random_state": seed}
                if model_name == "lightgbm":
                    m = lgb.LGBMClassifier(**p).fit(tr[feats], tr["severe"]); prob = m.predict_proba(va[feats])[:, 1]
                elif model_name == "xgboost":
                    m = xgb.XGBClassifier(**p).fit(tr[feats], tr["severe"]); prob = m.predict_proba(va[feats])[:, 1]
                else:
                    m = RandomForestClassifier(**p).fit(codes(tr[feats]), tr["severe"]); prob = m.predict_proba(codes(va[feats]))[:, 1]
                scores.append(average_precision_score(va["severe"], prob))
            results.setdefault(model_name, {})[name] = {
                "validation_pr_auc_mean": round(float(np.mean(scores)), 4),
                "validation_pr_auc_sd": round(float(np.std(scores)), 4), "seeds": len(seeds), "n_features": len(feats)}
            print(f"{model_name:13s} {name:34s} {np.mean(scores):.4f} +/- {np.std(scores):.4f}", flush=True)

    OUT.write_text(json.dumps({"judged_on": "validation PR-AUC (Jan-Jun 2024); tuned settings of each saved model; "
                               "LightGBM/XGBoost 3 seeds, Random Forest 1 seed", "results": results}, indent=2),
                   encoding="utf-8")


def codes(x: pd.DataFrame) -> pd.DataFrame:
    return x.assign(**{c: x[c].cat.codes for c in x.columns if isinstance(x[c].dtype, pd.CategoricalDtype)})


if __name__ == "__main__":
    main()
