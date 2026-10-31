"""Download BTS On-Time Reporting monthly files and keep the flights at the chosen airports.

Source: U.S. Bureau of Transportation Statistics, "Reporting Carrier On-Time Performance (1987-present)",
https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ (public domain, US government data).
Monthly zips come from https://transtats.bts.gov/PREZIP/.

Usage: uv run python pipeline/fetch_bts.py [--airports ATL DFW] [--start 2023-01] [--end 2025-07]
Writes data/raw/bts/*.zip (cached, git-ignored) and data/processed/bts_flights.csv.gz.
"""

import argparse
import io
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "bts"
OUT = ROOT / "data" / "processed" / "bts_flights.csv.gz"
URL = "https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{y}_{m}.zip"
COLUMNS = ["FlightDate", "Reporting_Airline", "Flight_Number_Reporting_Airline", "Tail_Number", "Origin", "Dest",
           "CRSDepTime", "DepTime", "DepDelay", "WheelsOff", "WheelsOn", "CRSArrTime", "ArrTime", "ArrDelay",
           "Cancelled", "CancellationCode", "Diverted", "CRSElapsedTime"]


def months(start: str, end: str) -> list[tuple[int, int]]:
    return [(p.year, p.month) for p in pd.period_range(start, end, freq="M")]


def download(y: int, m: int) -> Path:
    path = RAW / f"ontime_{y}_{m:02d}.zip"
    if path.exists() and zipfile.is_zipfile(path):
        return path
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(URL.format(y=y, m=m), timeout=600) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    tmp.replace(path)
    print(f"downloaded {path.name}", flush=True)
    return path


def extract(path: Path, airports: set[str]) -> pd.DataFrame:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as f:
            df = pd.read_csv(io.TextIOWrapper(f, encoding="latin-1"), usecols=COLUMNS, low_memory=False)
    return df[df["Origin"].isin(airports) | df["Dest"].isin(airports)]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--airports", nargs="+", default=["ATL", "DFW"])
    p.add_argument("--start", default="2023-01")
    p.add_argument("--end", default="2025-07")
    args = p.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda ym: download(*ym), months(args.start, args.end)))
    flights = pd.concat([extract(p, set(args.airports)) for p in paths], ignore_index=True)
    flights.to_csv(OUT, index=False)
    print(f"wrote {OUT}: {len(flights):,} flights touching {args.airports}")


if __name__ == "__main__":
    main()
