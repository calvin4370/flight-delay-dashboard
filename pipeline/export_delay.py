"""Export the delay classifier results in the approved D35 format.

Reads data/outputs/delay_metrics.json, delay_test_predictions.csv (from train_delay.py) and the provided flights +
hourly weather (via build_delay / build_aar). Writes data/outputs/delay_flights.json, delay_metrics.json (replaced
in D35 shape) and delay_trends.json.

Usage: uv run python pipeline/export_delay.py
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_aar import weather_features  # shared, not edited here
from build_delay import FLIGHT_COLS, FLIGHTS, targets_for

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "outputs"
RAW_METRICS = OUT / "delay_metrics_raw.json"  # train_delay.py output, kept for reference
SPLIT = {"train": ["2023-01-01", "2023-12-31"], "validation": ["2024-01-01", "2024-06-30"],
         "test": ["2024-07-01", "2025-07-31"]}
TOP_FACTORS = 3  # D35

LABELS = {
    "airport": "airport", "direction": "departure or arrival", "carrier": "airline", "distance": "flight distance (miles)",
    "local_hour": "scheduled local hour", "day_of_week": "day of week (0 = Mon)", "month": "month",
    "horizon_h": "hours ahead of the flight",
    "wx_temp_c": "temperature (°C)", "wx_dewpoint_c": "dew point (°C)", "wx_rel_humidity_pct": "relative humidity (%)",
    "wx_precip_mm": "rain in the hour (mm)", "wx_wind_speed_kmh": "wind speed (km/h)", "wx_pressure_hpa": "air pressure (hPa)",
    "wx_headwind_kmh": "headwind on the runway (km/h; negative = tailwind)", "wx_crosswind_kmh": "crosswind on the runway (km/h)",
    "wx_tailwind_kmh": "tailwind on the runway (km/h)", "wx_condition_code": "weather condition code",
    "win_max_precip": "heaviest rain in the 10 h window (mm/h)", "win_any_rain": "any rain in the 10 h window",
    "win_any_severe_wx": "heavy rain, snow/ice or thunderstorm in the 10 h window",
    "win_any_thunder": "thunderstorm in the 10 h window", "win_max_wind": "strongest wind in the 10 h window (km/h)",
    "win_max_crosswind": "strongest crosswind in the 10 h window (km/h)",
    "win_max_tailwind": "strongest tailwind in the 10 h window (km/h)",
    "win_pressure_change": "pressure change over the 10 h window (hPa)",
}
REASON = re.compile(r"(\w+)=(\S+) \(([+-][0-9.]+); ([^)]+)\)")


def header() -> dict:
    return {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "pipeline/export_delay.py (from train_delay.py)", "split": SPLIT}


def iso(ts) -> str | None:
    return None if pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%S")


def number(v: str):
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 2)
    except ValueError:
        return v


def factors(reasons: str, issue: str) -> list[dict]:
    out = []
    for feature, value, shap_val, _ in REASON.findall(reasons or "")[:TOP_FACTORS]:
        out.append({"feature": feature, "label": LABELS.get(feature, feature), "value": number(value),
                    "shap": round(float(shap_val), 3),
                    "observed_utc": issue if feature.startswith(("wx_", "win_")) else None})
    return out


def wx_group(code) -> str | None:
    if pd.isna(code):
        return None
    c = int(code)
    if c <= 2: return "clear"
    if c <= 4: return "cloudy"
    if c <= 6: return "fog"
    if c in (7, 8, 17): return "rain"
    if c in (9, 18): return "heavy rain"
    if c >= 23: return "thunderstorm"
    return "snow/ice"


def model_block(name: str, raw: dict) -> dict:
    t = raw["test"][name]
    block = {"name": name, "validation_pr_auc": raw["validation_pr_auc"][name], "threshold": raw["thresholds"][name],
             **{k: t[k] for k in ["pr_auc", "precision", "recall", "accuracy", "f1", "confusion_matrix", "positives", "rows"]},
             "by_airport_direction": {}, "by_horizon": {}}
    for bucket, key in [("test_by_airport_direction", "by_airport_direction"), ("test_by_horizon", "by_horizon")]:
        for label, per_model in raw[bucket].items():
            if name in per_model:
                m = per_model[name]
                block[key][label] = {k: m[k] for k in ["pr_auc", "precision", "recall", "accuracy", "f1", "confusion_matrix",
                                                       "positives", "rows"]}
    return block


def main() -> None:
    # train_delay.py writes delay_metrics.json; keep that as *_raw.json and replace it with the D35 shape.
    raw_path = OUT / "delay_metrics.json"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    if "selected_model" in raw:  # already exported once: read the raw copy instead
        raw = json.loads(RAW_METRICS.read_text(encoding="utf-8"))
    else:
        RAW_METRICS.write_text(json.dumps(raw, indent=2), encoding="utf-8")
    best = raw["best_model"]
    threshold = raw["thresholds"][best]

    # ------------------------------------------------ delay_flights.json
    pred = pd.read_csv(OUT / "delay_test_predictions.csv", parse_dates=["sched_local", "sched_utc", "issue_utc"])
    flights = []
    for r in pred.itertuples(index=False):
        issue = iso(r.issue_utc)
        flights.append({
            "flight_id": int(r.target_id), "airport": r.airport, "direction": r.direction, "carrier": r.carrier,
            "flight_number": None if pd.isna(r.OP_CARRIER_FL_NUM) else int(r.OP_CARRIER_FL_NUM),
            "origin": r.ORIGIN, "dest": r.DEST, "sched_utc": iso(r.sched_utc), "sched_local": iso(r.sched_local),
            "horizon_h": int(r.horizon_h), "issue_utc": issue, "risk": round(float(r.probability), 4),
            "alert": bool(r.probability >= threshold), "baseline_rate": round(float(r.baseline_probability), 4),
            "actual_severe": None if pd.isna(r.severe) else bool(r.severe), "top_factors": factors(r.reasons, issue),
        })
    flights_doc = {**header(), "selected_model": best, "threshold": threshold, "flights": flights}
    (OUT / "delay_flights.json").write_text(json.dumps(flights_doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------ delay_metrics.json
    failure_path = OUT / "delay_failure_cases.json"
    failure_cases = json.loads(failure_path.read_text(encoding="utf-8")) if failure_path.exists() else []
    metrics_doc = {
        **header(), "target": raw["target"], "selected_model": best, "selected_on": raw["selected_on"],
        "threshold": threshold, "threshold_rule": raw["threshold_rule"],
        "models": [model_block(m, raw) for m in raw["test"] if m != "baseline"],
        "baseline": {**model_block("baseline", raw),
                     "definition": "training-period severe rate for the same airport, direction, scheduled local hour and month (D22)"},
        "mean_abs_shap_top15": raw.get("mean_abs_shap_top15", {}),
        "failure_cases": failure_cases,
    }
    raw_path.write_text(json.dumps(metrics_doc, indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------ delay_trends.json (descriptive: whole labelled period)
    fl = pd.read_csv(FLIGHTS, usecols=FLIGHT_COLS, parse_dates=["FL_DATE"], low_memory=False)
    parts = []
    for a in ["ATL", "DFW"]:
        t = targets_for(fl, a)
        t = t[t["severe"].notna() & t["sched_utc"].notna()].copy()
        wf = weather_features(a)[["issue_utc", "wx_condition_code"]]
        t["hour_utc"] = t["sched_utc"].dt.floor("h")
        t = t.merge(wf, left_on="hour_utc", right_on="issue_utc", how="left")
        t["weather_group"] = t["wx_condition_code"].map(wx_group)
        parts.append(t)
    t = pd.concat(parts, ignore_index=True)
    t["severe"] = t["severe"].astype(int)

    def table(col: str) -> list[dict]:
        g = t.groupby(["airport", "direction", col], observed=True)["severe"].agg(["mean", "size"]).reset_index()
        return [{"airport": r.airport, "direction": r.direction, col: (r[col] if isinstance(r[col], str) else int(r[col])),
                 "rate": round(float(r["mean"]), 4), "n": int(r["size"])} for _, r in g.iterrows()]

    trends_doc = {**header(), "period": [str(t["local_date"].min().date()), str(t["local_date"].max().date())],
                  "note": "share of flights with DEP_DELAY / ARR_DELAY > 45 (rates, not raw minutes); weather group = "
                          "condition in the scheduled hour (descriptive history, not a model input)",
                  "severe_rate": {"month": table("month"), "local_hour": table("local_hour"),
                                  "weather_group": table("weather_group")}}
    (OUT / "delay_trends.json").write_text(json.dumps(trends_doc, indent=2, ensure_ascii=False), encoding="utf-8")

    for f in ["delay_flights.json", "delay_metrics.json", "delay_trends.json"]:
        print(f"{f}: {(OUT / f).stat().st_size / 1e6:.2f} MB")
    print(f"flights exported: {len(flights):,}; selected model: {best}; threshold: {threshold:.4f}")


if __name__ == "__main__":
    main()
