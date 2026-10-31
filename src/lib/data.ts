import { readFile } from "node:fs/promises";
import path from "node:path";

// D24: the pipeline writes JSON to data/outputs/ and the app reads it directly. Shapes follow D35.
const OUTPUTS = path.join(process.cwd(), "data", "outputs");

export type Factor = {
  feature: string;
  label: string;
  value: number | string | null;
  shap: number | null;
  observed_utc: string | null;
};

export type AarHour = {
  airport: string;
  time_utc: string;
  time_local: string;
  horizon_h: number;
  issue_utc: string;
  predicted_arrivals: number;
  interval_low: number;
  interval_high: number;
  baseline_arrivals: number | null;
  sarimax_arrivals: number | null;
  scheduled_arrivals: number;
  actual_arrivals: number | null;
  top_factors: Factor[];
};

export type FailureCase = {
  airport: string;
  time_utc: string;
  what_happened: string;
  predicted: number | string | null;
  actual: number | string | null;
  reason: string;
  how_user_knows: string;
};

export type AarModel = {
  name: string;
  validation_rmse: number;
  test_rmse: Record<string, number>;
  test_mae: Record<string, number>;
};

export type AarMetrics = {
  generated_utc: string;
  selected_model: string;
  selected_on: string;
  selection_note: string;
  target: string;
  test_rows: number;
  split: Record<string, [string, string]>;
  interval_80_by_horizon: Record<string, { low: number; high: number }>;
  models: AarModel[];
  baseline: AarModel;
  failure_cases: FailureCase[];
};

export type DelayFlight = {
  flight_id: string;
  airport: string;
  direction: "departure" | "arrival";
  carrier: string;
  flight_number: string | number;
  origin: string;
  dest: string;
  sched_utc: string;
  sched_local: string;
  horizon_h: number;
  issue_utc: string;
  risk: number;
  alert: boolean;
  baseline_rate: number | null;
  actual_severe: boolean | null;
  top_factors: Factor[];
};

// Delay files are owned by Calvin (D41); the app treats any field as optional and shows what is present.
export type DelayMetrics = Record<string, unknown> & { threshold?: number; selected_model?: string };
export type DelayTrends = Record<string, unknown>;

type AarFile = { selected_model: string; generated_utc: string; hours: AarHour[] };
type DelayFile = { flights: DelayFlight[]; threshold?: number; generated_utc?: string };

// Files are static between pipeline runs, so each is read and parsed once per server process. The promise is
// cached (not the value) so concurrent first requests share one parse of the 46 MB forecast.
const cache = new Map<string, Promise<unknown>>();

function readJson<T>(name: string): Promise<T | null> {
  if (!cache.has(name)) {
    cache.set(name, readFile(path.join(OUTPUTS, name), "utf8").then((s) => JSON.parse(s) as T).catch(() => null));
  }
  return cache.get(name) as Promise<T | null>; // null = not exported yet: views say so instead of guessing
}

export const aarForecast = () => readJson<AarFile>("aar_forecast.json");
export const aarMetrics = () => readJson<AarMetrics>("aar_metrics.json");
export const delayFlights = () => readJson<DelayFile>("delay_flights.json");
export const delayMetrics = () => readJson<DelayMetrics>("delay_metrics.json");
export const delayTrends = () => readJson<DelayTrends>("delay_trends.json");
export async function delayFailureCases() {
  const raw = await readJson<FailureCase[] | { failure_cases: FailureCase[] }>("delay_failure_cases.json");
  return raw ? (Array.isArray(raw) ? raw : raw.failure_cases) : null;
}

export type RateRow = { airport: string; key: string; rate: number };
export type AarIndex = {
  airports: string[];
  dates: Map<string, string[]>; // airport -> sorted local dates
  day: Map<string, AarHour[]>; // `${airport}|${horizon}|${localDate}` -> hours
  rates: { month: RateRow[]; hour: RateRow[] }; // arrivals landed / scheduled, 3 h rows (rates, not counts)
};

let indexPromise: Promise<AarIndex | null> | undefined;

// One pass over the forecast builds every lookup the views need, instead of re-scanning 76k rows per request.
export function aarIndex(): Promise<AarIndex | null> {
  indexPromise ??= aarForecast().then((f) => {
    if (!f) return null;
    const day = new Map<string, AarHour[]>();
    const dates = new Map<string, Set<string>>();
    const agg = new Map<string, { a: number; s: number }>();
    for (const h of f.hours) {
      const date = h.time_local.slice(0, 10);
      const k = `${h.airport}|${h.horizon_h}|${date}`;
      const list = day.get(k);
      if (list) list.push(h); else day.set(k, [h]);
      let ds = dates.get(h.airport);
      if (!ds) dates.set(h.airport, (ds = new Set()));
      ds.add(date);
      if (h.horizon_h === 3 && h.actual_arrivals != null) {
        for (const key of [`${h.airport}|month|${h.time_local.slice(0, 7)}`, `${h.airport}|hour|${h.time_local.slice(11, 13)}`]) {
          const v = agg.get(key) ?? { a: 0, s: 0 };
          v.a += h.actual_arrivals;
          v.s += h.scheduled_arrivals;
          agg.set(key, v);
        }
      }
    }
    const rows = (kind: string) =>
      [...agg.entries()]
        .filter(([k]) => k.split("|")[1] === kind)
        .map(([k, v]) => ({ airport: k.split("|")[0], key: k.split("|")[2], rate: v.s ? v.a / v.s : 0 }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.airport.localeCompare(b.airport));
    return {
      airports: [...dates.keys()].sort(),
      dates: new Map([...dates].map(([a, s]) => [a, [...s].sort()])),
      day,
      rates: { month: rows("month"), hour: rows("hour") },
    };
  });
  return indexPromise;
}

export const HORIZONS = [3, 6, 9, 12] as const;
