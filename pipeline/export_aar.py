"""Export AAR forecasts and metrics in the D35 JSON contract for the app.

Usage: uv run python pipeline/export_aar.py   (after train_aar.py)
Reads data/processed/aar_features.csv.gz, data/models/aar_<selected>.joblib, data/outputs/aar_metrics.json and
data/processed/aar_test_predictions.csv. Writes data/outputs/aar_forecast.json and rewrites aar_metrics.json in D35 shape.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from train_aar import SPLITS, TARGET, feature_matrix, split_of

ROOT = Path(__file__).resolve().parent.parent
PROC, MODELS, OUTPUTS = ROOT / "data" / "processed", ROOT / "data" / "models", ROOT / "data" / "outputs"
TOP_FACTORS = 3  # D35

LABELS = {
    "scheduled_arrivals": "scheduled arrivals that hour", "local_hour": "local hour", "day_of_week": "day of week",
    "month": "month", "airport": "airport", "horizon_h": "hours ahead",
    "wx_temp_c": "temperature (°C)", "wx_dewpoint_c": "dew point (°C)", "wx_rel_humidity_pct": "humidity (%)",
    "wx_precip_mm": "precipitation (mm/h)", "wx_wind_speed_kmh": "wind speed (km/h)", "wx_pressure_hpa": "pressure (hPa)",
    "wx_headwind_kmh": "headwind (km/h)", "wx_crosswind_kmh": "crosswind (km/h)", "wx_tailwind_kmh": "tailwind (km/h)",
    "wx_condition_code": "weather condition code",
    "win_max_precip": "max precipitation in 10 h window (mm/h)", "win_any_rain": "any rain in 10 h window",
    "win_any_severe_wx": "heavy rain/snow/thunder in 10 h window", "win_any_thunder": "thunderstorm in 10 h window",
    "win_max_wind": "max wind in 10 h window (km/h)", "win_max_crosswind": "max crosswind in 10 h window (km/h)",
    "win_max_tailwind": "max tailwind in 10 h window (km/h)", "win_pressure_change": "pressure change over 10 h window (hPa)",
}

FAILURE_REASONS = {
    ("ATL", "2024-07-19"): "Global CrowdStrike IT outage (19 Jul 2024) grounded many Delta flights; not visible in weather or schedule",
}


def iso(ts) -> str | None:
    return None if pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_iso(ts) -> str | None:
    return None if pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M")


def r(x, nd=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def main() -> None:
    # train_aar.py writes its raw metrics to aar_metrics.json; keep a copy so this export can be rerun.
    raw_path = MODELS / "aar_train_metrics.json"
    if not raw_path.exists() or "test_rmse" in json.loads((OUTPUTS / "aar_metrics.json").read_text()):
        raw_path.write_text((OUTPUTS / "aar_metrics.json").read_text())
    raw = json.loads(raw_path.read_text())
    selected = raw.get("best_model")
    feats = pd.read_csv(PROC / "aar_features.csv.gz", parse_dates=["time_utc", "issue_utc", "local_date"])
    feats["split"] = split_of(feats["local_date"])
    test = feats[feats["split"] == "test"].reset_index(drop=True)
    x = feature_matrix(test)
    model = joblib.load(MODELS / f"aar_{selected}.joblib")

    # Exact TreeSHAP contributions from LightGBM / XGBoost (last column = expected value).
    if selected == "lightgbm":
        contrib = model.predict(x, pred_contrib=True)
    else:
        import shap
        contrib = shap.TreeExplainer(model).shap_values(x)
        contrib = np.column_stack([contrib, np.zeros(len(x))])
    pred = model.predict(x)
    preds = pd.read_csv(PROC / "aar_test_predictions.csv", parse_dates=["time_utc"])
    test = test.merge(preds[["airport", "time_utc", "horizon_h", "baseline", "sarimax"]],
                      on=["airport", "time_utc", "horizon_h"], how="left")
    interval = raw["interval_80_by_horizon"]

    cols = list(x.columns)
    hours = []
    for i, row in test.iterrows():
        c = contrib[i, :-1]
        top = np.argsort(-np.abs(c))[:TOP_FACTORS]
        factors = []
        for j in top:
            f = cols[j]
            observed = row["issue_utc"] if f.startswith(("wx_", "win_")) else None
            val = row[f] if f in row else None
            factors.append({"feature": f, "label": LABELS.get(f, f),
                            "value": val if isinstance(val, str) else r(val),
                            "shap": r(c[j]), "observed_utc": iso(observed)})
        h = str(int(row["horizon_h"]))
        p = float(pred[i])
        hours.append({
            "airport": row["airport"], "time_utc": iso(row["time_utc"]),
            "time_local": local_iso(row["time_utc"] + pd.Timedelta(hours=float(
                ((row["local_hour"] - row["time_utc"].hour + 12) % 24) - 12))),
            "horizon_h": int(row["horizon_h"]), "issue_utc": iso(row["issue_utc"]),
            "predicted_arrivals": r(p, 1),
            "interval_low": r(max(0.0, p + interval[h]["low"]), 1), "interval_high": r(p + interval[h]["high"], 1),
            "baseline_arrivals": r(row["baseline"], 1), "sarimax_arrivals": r(row["sarimax"], 1),
            "scheduled_arrivals": int(row["scheduled_arrivals"]), "actual_arrivals": int(row[TARGET]),
            "top_factors": factors,
        })

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    header = {"generated_utc": now, "source": "pipeline/export_aar.py", "split": SPLITS}
    (OUTPUTS / "aar_forecast.json").write_text(json.dumps({
        **header, "selected_model": selected,
        "target": "AAR proxy: realised arrivals (wheels-on) per airport per UTC hour (D8)",
        "interval": "80% range from the selected model's validation errors at the same horizon",
        "hours": hours}, separators=(",", ":")))

    # Failure cases (D28): largest misses of the selected model at the 3 h horizon.
    errs = pd.read_csv(PROC / "aar_largest_errors.csv", parse_dates=["time_utc"])
    failure_cases = []
    for _, e in errs.head(5).iterrows():
        local_day = (e["time_utc"] + pd.Timedelta(hours=float(((e["local_hour"] - e["time_utc"].hour + 12) % 24) - 12))).strftime("%Y-%m-%d")
        failure_cases.append({
            "airport": e["airport"], "time_utc": iso(e["time_utc"]),
            "what_happened": f"{int(e[TARGET])} arrivals landed against {int(e['scheduled_arrivals'])} scheduled",
            "predicted": r(e[selected], 1), "actual": int(e[TARGET]),
            "reason": FAILURE_REASONS.get((e["airport"], local_day),
                                          "Arrivals collapsed without a matching weather signal 3 h earlier "
                                          "(likely a ground stop, outage or data gap); the model only sees schedule and weather"),
            "how_user_knows": "Actual arrivals fall far below the forecast range in the first hour; the TMC's live "
                              "traffic picture shows the gap before the model would",
        })

    def model_entry(name):
        groups = raw["test_rmse"]
        return {"name": name, "validation_rmse": r(raw["validation_rmse"][name], 3),
                "test_rmse": {k: r(v[name], 3) for k, v in groups.items()},
                "test_mae": {k: r(v[name], 3) for k, v in raw["test_mae"].items()}}

    names = [m for m in raw["validation_rmse"] if m != "baseline"]
    metrics = {**header, "selected_model": selected, "selected_on": raw.get("selected_on", "validation"),
               "selection_note": "Selected among the tree models on validation RMSE (D20, D44): they use weather and "
                                 "give SHAP evidence (D27). SARIMAX is a schedule-only time-series comparison (D44); "
                                 "it scores lower RMSE because it uses the arrivals counted up to the issue time.",
               "target": raw["target"], "test_rows": raw["test_rows"],
               "interval_80_by_horizon": interval,
               "models": [model_entry(n) for n in names], "baseline": model_entry("baseline"),
               "best_params": raw["best_params"], "failure_cases": failure_cases}
    (OUTPUTS / "aar_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    print(f"aar_forecast.json: {len(hours):,} hours; aar_metrics.json: {len(metrics['models'])} models, "
          f"{len(failure_cases)} failure cases")


if __name__ == "__main__":
    main()
