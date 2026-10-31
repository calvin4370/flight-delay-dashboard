"""Fetch hourly airport weather from Meteostat and add runway wind components.

Source: Meteostat bulk hourly data (https://dev.meteostat.net/bulk/hourly.html),
which is built from NOAA ISD and DWD observations. Licence: CC BY-NC 4.0.
Times in the source are UTC.

Usage: uv run python pipeline/fetch_weather.py [--airports ATL DFW] [--start 2023-01-01] [--end 2025-07-31]
Writes data/processed/weather_hourly.csv (same columns as data/raw/challenge5_hourly_weather_ATL_DFW.csv, plus station and
utc_offset_h). For ATL/DFW it reproduces the provided file exactly (checked 2026-10-31, 45,264 hours).
"""

import argparse
import io
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

# Any airport works once it has a row here: Meteostat station id, IANA time zone,
# and the runway heading the challenge tells us to assume.
AIRPORTS = {
    "ATL": {"station": "72219", "tz": "America/New_York", "runway_heading_deg": 80},
    "DFW": {"station": "72259", "tz": "America/Chicago", "runway_heading_deg": 180},
}

BULK_URL = "https://bulk.meteostat.net/v2/hourly/{station}.csv.gz"
COLUMNS = ["date", "hour", "temp", "dwpt", "rhum", "prcp", "snow", "wdir", "wspd", "wpgt", "pres", "tsun", "coco"]
OUT = Path(__file__).resolve().parent.parent / "data" / "processed" / "weather_hourly.csv"


def fetch_station(station: str) -> pd.DataFrame:
    with urllib.request.urlopen(BULK_URL.format(station=station), timeout=120) as resp:
        raw = resp.read()
    return pd.read_csv(io.BytesIO(raw), compression="gzip", header=None, names=COLUMNS)


def runway_components(wspd: pd.Series, wdir: pd.Series, heading: float) -> pd.DataFrame:
    # wdir is where the wind blows FROM, so a wind straight down the runway heading is a pure headwind.
    angle = np.deg2rad(wdir - heading)
    headwind = wspd * np.cos(angle)
    return pd.DataFrame({
        "headwind_kmh": headwind.round(1),
        "crosswind_kmh": (wspd * np.sin(angle)).abs().round(1),
        "tailwind_kmh": (-headwind).clip(lower=0).round(1),
    })


def build(airport: str, start: str, end: str) -> pd.DataFrame:
    cfg = AIRPORTS[airport]
    df = fetch_station(cfg["station"])
    df["time_utc"] = pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour"], unit="h")
    df["time_utc"] = df["time_utc"].dt.tz_localize("UTC")
    # Pad the window by a day each side so local-time hours at the edges are kept.
    lo = pd.Timestamp(start, tz=cfg["tz"]) - pd.Timedelta(days=1)
    hi = pd.Timestamp(end, tz=cfg["tz"]) + pd.Timedelta(days=2)
    df = df[(df["time_utc"] >= lo) & (df["time_utc"] < hi)].copy()

    df["time_local"] = df["time_utc"].dt.tz_convert(cfg["tz"])
    # Calm: Meteostat reports direction 0 or blank with zero speed; there is no wind to resolve.
    calm = df["wspd"].fillna(0).eq(0)
    df.loc[calm, "wdir"] = 0
    wind = runway_components(df["wspd"], df["wdir"], cfg["runway_heading_deg"])

    out = pd.DataFrame({
        "airport": airport,
        "station": cfg["station"],
        "runway_heading_deg": cfg["runway_heading_deg"],
        "time_utc": df["time_utc"].dt.strftime("%Y-%m-%d %H:%M"),
        "time_local": df["time_local"].dt.strftime("%Y-%m-%d %H:%M"),
        "utc_offset_h": df["time_local"].map(lambda t: t.utcoffset().total_seconds() / 3600),
        "temp_c": df["temp"],
        "dew_point_c": df["dwpt"],
        "rel_humidity_pct": df["rhum"],
        "precip_mm": df["prcp"],
        "wind_dir_deg": df["wdir"],
        "wind_speed_kmh": df["wspd"],
        "wind_gust_kmh": df["wpgt"],
        "pressure_hpa": df["pres"],
        "condition_code": df["coco"],
    }).reset_index(drop=True)
    return pd.concat([out, wind.reset_index(drop=True)], axis=1)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--airports", nargs="+", default=list(AIRPORTS), choices=list(AIRPORTS))
    p.add_argument("--start", default="2023-01-01")
    p.add_argument("--end", default="2025-07-31")
    args = p.parse_args()

    frames = []
    for ap in args.airports:
        df = build(ap, args.start, args.end)
        print(f"{ap}: {len(df):,} hourly rows, {df['time_local'].min()} to {df['time_local'].max()} local")
        frames.append(df)
    OUT.parent.mkdir(exist_ok=True)
    pd.concat(frames).to_csv(OUT, index=False)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
