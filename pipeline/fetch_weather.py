"""Resolve any airport code and fetch its hourly weather with runway wind components (D13, D39 option A).

Sources (public, fetched by script, cached under data/processed/airports/):
- OurAirports (https://ourairports.com/data/, public domain): airports.csv (IATA <-> ICAO, coordinates) and
  runways.csv (runway identifiers and headings).
- Meteostat (https://dev.meteostat.net/bulk/, CC BY-NC 4.0): stations/lite.json.gz (station id, ICAO, IANA time
  zone, coordinates) and hourly/<station>.csv.gz (observations from NOAA ISD and DWD, UTC).

Runway heading assumption: ATL 80 deg and DFW 180 deg come from the brief. For any other airport we use the most
common runway direction at that airport in OurAirports (ties: the longest runway), stated in `heading_source`.

Interface for other pipeline scripts (build_aar.py, build_delay.py):
    from fetch_weather import resolve_airport, hourly_weather
    info = resolve_airport("KORD")      # or "ORD"
    # {'iata': 'ORD', 'icao': 'KORD', 'name': ..., 'lat': ..., 'lon': ..., 'station': '72530',
    #  'tz': 'America/Chicago', 'runway_heading_deg': ..., 'heading_source': ...}
    wx = hourly_weather("ORD", "2023-01-01", "2025-07-31")
    # same columns and time format as data/raw/challenge5_hourly_weather_ATL_DFW.csv

Usage: uv run python pipeline/fetch_weather.py [--airports ATL DFW KORD] [--start 2023-01-01] [--end 2025-07-31]
Writes data/processed/weather_hourly.csv. For ATL/DFW it reproduces the provided file exactly (checked 2026-10-31).
"""

import argparse
import functools
import gzip
import io
import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "processed" / "airports"
OUT = ROOT / "data" / "processed" / "weather_hourly.csv"

OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data/{name}"
STATIONS_URL = "https://bulk.meteostat.net/v2/stations/lite.json.gz"
HOURLY_URL = "https://bulk.meteostat.net/v2/hourly/{station}.csv.gz"
HOURLY_COLUMNS = ["date", "hour", "temp", "dwpt", "rhum", "prcp", "snow", "wdir", "wspd", "wpgt", "pres", "tsun", "coco"]

# The brief fixes these headings; they override the OurAirports-derived direction.
BRIEF_HEADINGS = {"ATL": 80, "DFW": 180}
# Columns of the provided hourly weather file, in its order.
WEATHER_COLUMNS = ["airport", "runway_heading_deg", "time_utc", "time_local", "temp_c", "dewpoint_c",
                   "rel_humidity_pct", "precip_mm", "wind_dir_deg", "wind_speed_kmh", "wind_gust_kmh",
                   "pressure_hpa", "condition_code", "headwind_kmh", "crosswind_kmh", "tailwind_kmh"]


def _download(url: str, name: str) -> Path:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as resp:
            path.write_bytes(resp.read())
    return path


@functools.cache
def _airports() -> pd.DataFrame:
    return pd.read_csv(_download(OURAIRPORTS.format(name="airports.csv"), "airports.csv"), low_memory=False,
                       usecols=["ident", "type", "name", "latitude_deg", "longitude_deg", "gps_code", "icao_code", "iata_code"])


@functools.cache
def _runways() -> pd.DataFrame:
    return pd.read_csv(_download(OURAIRPORTS.format(name="runways.csv"), "runways.csv"), low_memory=False,
                       usecols=["airport_ident", "length_ft", "closed", "le_ident", "le_heading_degT", "he_ident"])


@functools.cache
def _stations() -> list[dict]:
    with gzip.open(_download(STATIONS_URL, "meteostat_stations_lite.json.gz"), "rt", encoding="utf-8") as f:
        return json.load(f)


def _runway_heading(icao: str) -> tuple[float, str]:
    """Most common runway direction (10-deg steps, low end) at the airport; ties go to the longest runway."""
    r = _runways()
    r = r[(r["airport_ident"] == icao) & (r["closed"] != 1)].copy()
    num = pd.to_numeric(r["le_ident"].astype(str).str.extract(r"^(\d{1,2})")[0], errors="coerce")
    r["heading"] = r["le_heading_degT"].fillna(num * 10)
    r = r.dropna(subset=["heading"])
    if r.empty:
        raise LookupError(f"no runway heading for {icao} in OurAirports")
    r["dir"] = (r["heading"] / 10).round().astype(int) % 36 * 10
    best = r.groupby("dir").agg(n=("dir", "size"), length=("length_ft", "max")).sort_values(["n", "length"]).index[-1]
    return float(best), f"most common runway direction in OurAirports ({icao}); assumption, not the active runway"


def _nearest_station(lat: float, lon: float) -> dict:
    best, best_d = None, np.inf
    for s in _stations():
        loc = s.get("location") or {}
        if loc.get("latitude") is None:
            continue
        d = np.hypot(loc["latitude"] - lat, (loc["longitude"] - lon) * np.cos(np.deg2rad(lat)))
        if d < best_d:
            best, best_d = s, d
    return best


@functools.cache
def resolve_airport(code: str) -> dict:
    """IATA (ATL) or ICAO (KATL) -> identifiers, Meteostat station, IANA time zone and runway heading."""
    code = code.strip().upper()
    a = _airports()
    col = "iata_code" if len(code) == 3 else "icao_code"
    hit = a[a[col] == code]
    if hit.empty and len(code) == 4:
        hit = a[(a["gps_code"] == code) | (a["ident"] == code)]
    if hit.empty:
        raise LookupError(f"unknown airport code {code!r} (not in OurAirports)")
    row = hit.sort_values("type").iloc[0]
    icao = row["icao_code"] if isinstance(row["icao_code"], str) else row["gps_code"]
    iata = row["iata_code"] if isinstance(row["iata_code"], str) else None

    station = next((s for s in _stations() if (s.get("identifiers") or {}).get("icao") == icao), None)
    match = "ICAO match"
    if station is None:
        station, match = _nearest_station(row["latitude_deg"], row["longitude_deg"]), "nearest station"

    if iata in BRIEF_HEADINGS:
        heading, source = float(BRIEF_HEADINGS[iata]), "brief (Challenge 5 assumption)"
    else:
        heading, source = _runway_heading(icao)
    return {"iata": iata, "icao": icao, "name": row["name"], "lat": float(row["latitude_deg"]),
            "lon": float(row["longitude_deg"]), "station": station["id"], "station_match": match,
            "tz": station["timezone"], "runway_heading_deg": heading, "heading_source": source}


def runway_components(wspd: pd.Series, wdir: pd.Series, heading: float) -> pd.DataFrame:
    # wdir is where the wind blows FROM, so a wind straight down the runway heading is a pure headwind.
    angle = np.deg2rad(wdir - heading)
    headwind = wspd * np.cos(angle)
    return pd.DataFrame({
        "headwind_kmh": headwind.round(1),
        "crosswind_kmh": (wspd * np.sin(angle)).abs().round(1),
        "tailwind_kmh": (-headwind).clip(lower=0).round(1),
    })


def hourly_weather(code: str, start: str, end: str) -> pd.DataFrame:
    """Hourly observations for [start, end] (UTC dates) in the provided file's columns and time format."""
    info = resolve_airport(code)
    with urllib.request.urlopen(HOURLY_URL.format(station=info["station"]), timeout=120) as resp:
        df = pd.read_csv(io.BytesIO(resp.read()), compression="gzip", header=None, names=HOURLY_COLUMNS)
    utc = pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour"], unit="h")
    df = df[(utc >= start) & (utc < pd.Timestamp(end) + pd.Timedelta(days=1))].copy()
    utc = (pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour"], unit="h")).dt.tz_localize("UTC")
    local = utc.dt.tz_convert(info["tz"])
    calm = df["wspd"].fillna(0).eq(0)  # calm: no wind to resolve, direction 0
    df.loc[calm, "wdir"] = 0
    wind = runway_components(df["wspd"], df["wdir"], info["runway_heading_deg"])
    out = pd.DataFrame({
        "airport": info["iata"] or info["icao"],
        "runway_heading_deg": info["runway_heading_deg"],
        "time_utc": utc.dt.strftime("%Y-%m-%d %H:%M:%S"),
        "time_local": local.dt.strftime("%Y-%m-%d %H:%M:%S"),
        "temp_c": df["temp"], "dewpoint_c": df["dwpt"], "rel_humidity_pct": df["rhum"], "precip_mm": df["prcp"],
        "wind_dir_deg": df["wdir"], "wind_speed_kmh": df["wspd"], "wind_gust_kmh": df["wpgt"],
        "pressure_hpa": df["pres"], "condition_code": df["coco"],
    }).reset_index(drop=True)
    out = pd.concat([out, wind.reset_index(drop=True)], axis=1)[WEATHER_COLUMNS]
    return out.assign(station=info["station"], heading_source=info["heading_source"])


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--airports", nargs="+", default=["ATL", "DFW"], help="IATA or ICAO codes")
    p.add_argument("--start", default="2023-01-01")
    p.add_argument("--end", default="2025-07-31")
    args = p.parse_args()

    frames = []
    for code in args.airports:
        info = resolve_airport(code)
        df = hourly_weather(code, args.start, args.end)
        print(f"{code}: {info['icao']} station {info['station']} ({info['station_match']}), tz {info['tz']}, "
              f"runway {info['runway_heading_deg']:.0f} deg [{info['heading_source']}]; {len(df):,} hours")
        frames.append(df)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(frames).to_csv(OUT, index=False)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
