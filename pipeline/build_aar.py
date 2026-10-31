"""Build the hourly AAR dataset: realised arrivals per airport per UTC hour, with features per forecast horizon.

Target (D8): AAR proxy = actual arrivals (wheels-on) at the airport in each UTC hour, from full BTS data.
Rows (D34): one per airport x target hour x horizon (3/6/9/12 h). Weather features use only observations at or
before the issue time (target hour - horizon), so every input is at least 3 h old (D4).

Usage: uv run python pipeline/build_aar.py [--airports ATL DFW]
Reads data/processed/bts_flights.csv.gz and data/raw/challenge5_hourly_weather_ATL_DFW.csv.
Writes data/processed/aar_hourly.csv.gz (one row per airport-hour) and data/processed/aar_features.csv.gz.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from fetch_weather import hourly_weather, resolve_airport

ROOT = Path(__file__).resolve().parent.parent
BTS = ROOT / "data" / "processed" / "bts_flights.csv.gz"
WEATHER = ROOT / "data" / "raw" / "challenge5_hourly_weather_ATL_DFW.csv"
OUT_HOURLY = ROOT / "data" / "processed" / "aar_hourly.csv.gz"
OUT_FEATURES = ROOT / "data" / "processed" / "aar_features.csv.gz"

# ATL/DFW use the provided weather file; any other airport is resolved and fetched by fetch_weather.py (D13, D39).
HORIZONS = [3, 6, 9, 12]
WINDOW_H = 10  # issue hour and the 9 hours before it: the 3-12 h window at the 3 h horizon
START, END = "2023-01-01 00:00", "2025-07-31 23:00"


def to_iata(code: str) -> str:
    """Accept IATA (ATL) or ICAO (KATL) via the OurAirports lookup."""
    return resolve_airport(code)["iata"]


def tz_of(airport: str) -> str:
    return resolve_airport(airport)["tz"]


def minutes(hhmm: pd.Series) -> pd.Series:
    return (hhmm // 100) % 24 * 60 + hhmm % 100


def local_to_utc_hour(local: pd.Series, tz: str) -> pd.Series:
    utc = local.dt.tz_localize(tz, ambiguous="NaT", nonexistent="shift_forward").dt.tz_convert("UTC").dt.tz_localize(None)
    return utc.dt.floor("h")


def arrivals_for(bts: pd.DataFrame, airport: str) -> pd.DataFrame:
    """Scheduled and actual (wheels-on) arrival hours, in UTC, for flights into the airport."""
    a = bts[bts["Dest"] == airport].copy()
    dep_date = pd.to_datetime(a["FlightDate"])
    # FlightDate is the departure date; move overnight arrivals to the next day using the scheduled elapsed time.
    clock_diff = minutes(a["CRSArrTime"]) - minutes(a["CRSDepTime"])
    day_shift = ((a["CRSElapsedTime"] - clock_diff) / 1440).round().fillna(0).astype(int)
    sched_local = dep_date + pd.to_timedelta(day_shift, unit="D") + pd.to_timedelta(minutes(a["CRSArrTime"]), unit="m")

    # Wheels-on is a local clock time; pick its date from the gate arrival (scheduled + arrival delay).
    landed = a["WheelsOn"].notna() & (a["Cancelled"] == 0) & (a["Diverted"] == 0)
    gate = sched_local + pd.to_timedelta(a["ArrDelay"].fillna(0), unit="m")
    on = gate.dt.normalize() + pd.to_timedelta(minutes(a["WheelsOn"].fillna(0)), unit="m")
    on = on.where(on - gate <= pd.Timedelta(hours=12), on - pd.Timedelta(days=1))
    on = on.where(gate - on <= pd.Timedelta(hours=12), on + pd.Timedelta(days=1))

    tz = tz_of(airport)
    return pd.DataFrame({
        "sched_hour": local_to_utc_hour(sched_local, tz),
        "actual_hour": local_to_utc_hour(on, tz).where(landed),
    })


def hourly_table(bts: pd.DataFrame, airport: str) -> pd.DataFrame:
    arr = arrivals_for(bts, airport)
    hours = pd.date_range(START, END, freq="h")
    t = pd.DataFrame(index=hours)
    t["arrivals"] = arr["actual_hour"].value_counts().reindex(hours, fill_value=0)
    t["scheduled_arrivals"] = arr["sched_hour"].value_counts().reindex(hours, fill_value=0)
    local = t.index.tz_localize("UTC").tz_convert(tz_of(airport)).tz_localize(None)
    t["local_hour"], t["day_of_week"], t["month"] = local.hour, local.day_of_week, local.month
    t["local_date"] = local.normalize()
    t["airport"] = airport
    return t.rename_axis("time_utc").reset_index()


def weather_features(airport: str) -> pd.DataFrame:
    """Per issue hour: latest observation plus summaries of the WINDOW_H hours ending at the issue hour."""
    w = pd.read_csv(WEATHER, parse_dates=["time_utc"])
    w = w[w["airport"] == airport]
    if w.empty:  # not in the provided file: fetch from the same public source by script
        w = hourly_weather(airport, START[:10], END[:10]).assign(time_utc=lambda d: pd.to_datetime(d["time_utc"]))
    w = w.set_index("time_utc").sort_index()
    w = w.reindex(pd.date_range(w.index.min(), w.index.max(), freq="h"))
    code = w["condition_code"]
    rain = (w["precip_mm"] > 0).astype(float)
    severe = (code.isin([9, 18]) | code.between(10, 16) | (code >= 23)).astype(float)
    thunder = (code >= 23).astype(float)
    roll = lambda s: s.rolling(WINDOW_H, min_periods=1)
    f = pd.DataFrame({
        "wx_temp_c": w["temp_c"], "wx_dewpoint_c": w["dewpoint_c"], "wx_rel_humidity_pct": w["rel_humidity_pct"],
        "wx_precip_mm": w["precip_mm"], "wx_wind_speed_kmh": w["wind_speed_kmh"], "wx_pressure_hpa": w["pressure_hpa"],
        "wx_headwind_kmh": w["headwind_kmh"], "wx_crosswind_kmh": w["crosswind_kmh"], "wx_tailwind_kmh": w["tailwind_kmh"],
        "wx_condition_code": code,
        "win_max_precip": roll(w["precip_mm"]).max(),
        "win_any_rain": roll(rain).max(),
        "win_any_severe_wx": roll(severe).max(),
        "win_any_thunder": roll(thunder).max(),
        "win_max_wind": roll(w["wind_speed_kmh"]).max(),
        "win_max_crosswind": roll(w["crosswind_kmh"]).max(),
        "win_max_tailwind": roll(w["tailwind_kmh"]).max(),
        "win_pressure_change": w["pressure_hpa"] - w["pressure_hpa"].shift(WINDOW_H - 1),
    })
    return f.rename_axis("issue_utc").reset_index()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--airports", nargs="+", default=["ATL", "DFW"])
    args = p.parse_args()
    airports = [to_iata(a) for a in args.airports]

    bts = pd.read_csv(BTS, low_memory=False)
    hourly = pd.concat([hourly_table(bts, a) for a in airports], ignore_index=True)
    OUT_HOURLY.parent.mkdir(parents=True, exist_ok=True)
    hourly.to_csv(OUT_HOURLY, index=False)

    rows = []
    for a in airports:
        wf = weather_features(a)
        h = hourly[hourly["airport"] == a]
        for horizon in HORIZONS:
            x = h.assign(horizon_h=horizon, issue_utc=h["time_utc"] - pd.Timedelta(hours=horizon))
            rows.append(x.merge(wf, on="issue_utc", how="left"))
    feats = pd.concat(rows, ignore_index=True)

    # Leakage check (D4): every weather input is observed at least 3 h before the target hour starts.
    gap_h = (feats["time_utc"] - feats["issue_utc"]).dt.total_seconds() / 3600
    assert gap_h.min() >= 3, "leakage: weather newer than 3 h before the target hour"
    feats.to_csv(OUT_FEATURES, index=False)

    print(f"hourly rows: {len(hourly):,}; feature rows: {len(feats):,}; min weather gap: {gap_h.min():.0f} h")
    print(hourly.groupby("airport")[["arrivals", "scheduled_arrivals"]].describe().T.round(1))


if __name__ == "__main__":
    main()
