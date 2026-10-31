"""Build the delay-classifier dataset: one row per ATL/DFW flight target x forecast horizon.

Target (D3, D9): severe = DEP_DELAY > 45 for departures from the airport, ARR_DELAY > 45 for arrivals into it.
Rows (D10): each target repeated for horizons 3/6/9/12 h. At horizon h the weather features are the reading at
h hours before the scheduled time plus summaries of the 10 hours ending there (D42), so every input is at least
h hours old (D4). Flight local times are converted to UTC per airport before matching weather (D40).
Features (D12): airport, direction, scheduled local hour, day of week, month, carrier, distance + weather.

Usage: uv run python pipeline/build_delay.py [--airports ATL DFW]
Reads data/raw/Flight_Data_With_Weather_Final.csv and the hourly weather (via build_aar.weather_features).
Writes data/processed/delay_features.csv.gz.
"""

import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_aar import TIMEZONES, to_iata, weather_features  # shared with the AAR pipeline; not edited here

ROOT = Path(__file__).resolve().parent.parent
FLIGHTS = ROOT / "data" / "raw" / "Flight_Data_With_Weather_Final.csv"
OUT = ROOT / "data" / "processed" / "delay_features.csv.gz"
HORIZONS = [3, 6, 9, 12]
SEVERE_MIN = 45
FLIGHT_COLS = ["FL_DATE", "OP_UNIQUE_CARRIER", "OP_CARRIER_FL_NUM", "TAIL_NUM", "ORIGIN", "DEST",
               "CRS_DEP_TIME", "CRS_ARR_TIME", "CRS_ELAPSED_TIME", "DISTANCE", "DEP_DELAY", "ARR_DELAY"]


def minutes(hhmm: pd.Series) -> pd.Series:
    return (hhmm // 100) % 24 * 60 + hhmm % 100


def targets_for(flights: pd.DataFrame, airport: str) -> pd.DataFrame:
    """Departures from and arrivals into one airport, with scheduled local and UTC times and the label."""
    dep = flights[flights["ORIGIN"] == airport].copy()
    dep["direction"] = "departure"
    dep["sched_local"] = dep["FL_DATE"] + pd.to_timedelta(minutes(dep["CRS_DEP_TIME"]), unit="m")
    dep["delay_min"] = dep["DEP_DELAY"]

    arr = flights[flights["DEST"] == airport].copy()
    arr["direction"] = "arrival"
    # FL_DATE is the departure date; move overnight arrivals to the next day using the scheduled elapsed time.
    clock_diff = minutes(arr["CRS_ARR_TIME"]) - minutes(arr["CRS_DEP_TIME"])
    day_shift = ((arr["CRS_ELAPSED_TIME"] - clock_diff) / 1440).round().fillna(0).astype(int)
    arr["sched_local"] = (arr["FL_DATE"] + pd.to_timedelta(day_shift, unit="D")
                          + pd.to_timedelta(minutes(arr["CRS_ARR_TIME"]), unit="m"))
    arr["delay_min"] = arr["ARR_DELAY"]

    t = pd.concat([dep, arr], ignore_index=True)
    t["airport"] = airport
    t["sched_utc"] = (t["sched_local"].dt.tz_localize(TIMEZONES[airport], ambiguous="NaT", nonexistent="shift_forward")
                      .dt.tz_convert("UTC").dt.tz_localize(None))
    t["severe"] = (t["delay_min"] > SEVERE_MIN).astype("Int64").where(t["delay_min"].notna())
    t["local_hour"] = t["sched_local"].dt.hour
    t["day_of_week"] = t["sched_local"].dt.day_of_week
    t["month"] = t["sched_local"].dt.month
    t["local_date"] = t["sched_local"].dt.normalize()
    t["carrier"] = t["OP_UNIQUE_CARRIER"]
    t["distance"] = t["DISTANCE"]
    return t


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--airports", nargs="+", default=["ATL", "DFW"])
    args = p.parse_args()
    airports = [to_iata(a) for a in args.airports]
    missing = [a for a in airports if a not in TIMEZONES]
    if missing:
        raise SystemExit(f"no time zone / weather configured for {missing} (see D13 / D39)")

    flights = pd.read_csv(FLIGHTS, usecols=FLIGHT_COLS, parse_dates=["FL_DATE"], low_memory=False)
    targets = pd.concat([targets_for(flights, a) for a in airports], ignore_index=True)

    n_all = len(targets)
    no_time = targets["sched_utc"].isna()
    no_label = targets["severe"].isna()
    targets = targets[~no_time & ~no_label].reset_index(drop=True)
    targets["target_id"] = targets.index

    rows = []
    for a in airports:
        wf = weather_features(a)
        t = targets[targets["airport"] == a]
        for h in HORIZONS:
            # Latest whole hour at least h hours before the scheduled time (D4, D42).
            x = t.assign(horizon_h=h, issue_utc=(t["sched_utc"] - pd.Timedelta(hours=h)).dt.floor("h"))
            rows.append(x.merge(wf, on="issue_utc", how="left"))
    feats = pd.concat(rows, ignore_index=True)

    # Leakage check (D4, D42): weather at horizon h is observed at least h hours before the scheduled time.
    gap_h = (feats["sched_utc"] - feats["issue_utc"]).dt.total_seconds() / 3600
    assert (gap_h >= feats["horizon_h"]).all(), "leakage: weather newer than the horizon"
    assert gap_h.min() >= 3, "leakage: weather newer than 3 h before the scheduled time"
    assert not any(c.startswith(("wpgt", "snow")) for c in feats.columns), "placeholder columns must not be used"

    keep = ["target_id", "airport", "direction", "carrier", "distance", "local_hour", "day_of_week", "month",
            "local_date", "sched_local", "sched_utc", "horizon_h", "issue_utc", "delay_min", "severe",
            "OP_CARRIER_FL_NUM", "ORIGIN", "DEST"] + [c for c in wf.columns if c != "issue_utc"]
    feats = feats[keep]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    feats.to_csv(OUT, index=False)

    print(f"targets: {n_all:,}; without a delay value (no label): {int(no_label.sum()):,}; "
          f"ambiguous local time: {int(no_time.sum()):,}; labelled: {len(targets):,}")
    print(f"feature rows: {len(feats):,} ({len(HORIZONS)} horizons); min weather gap: {gap_h.min():.1f} h; "
          f"weather found: {feats['wx_temp_c'].notna().mean():.2%}")
    print(targets.groupby(["airport", "direction"])["severe"].agg(["size", "mean"]).round(3))


if __name__ == "__main__":
    main()
