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

type Cache = {
  aar?: { selected_model: string; generated_utc: string; hours: AarHour[] } | null;
  aarMetrics?: AarMetrics | null;
  delayFlights?: { flights: DelayFlight[]; threshold?: number; generated_utc?: string } | null;
  delayMetrics?: DelayMetrics | null;
  delayTrends?: DelayTrends | null;
  delayFailures?: FailureCase[] | null;
};
const cache: Cache = {};

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(OUTPUTS, name), "utf8")) as T;
  } catch {
    return null; // file not exported yet: views say so instead of guessing
  }
}

export async function aarForecast() {
  if (cache.aar === undefined) cache.aar = await readJson("aar_forecast.json");
  return cache.aar;
}
export async function aarMetrics() {
  if (cache.aarMetrics === undefined) cache.aarMetrics = await readJson<AarMetrics>("aar_metrics.json");
  return cache.aarMetrics;
}
export async function delayFlights() {
  if (cache.delayFlights === undefined) cache.delayFlights = await readJson("delay_flights.json");
  return cache.delayFlights;
}
export async function delayMetrics() {
  if (cache.delayMetrics === undefined) cache.delayMetrics = await readJson<DelayMetrics>("delay_metrics.json");
  return cache.delayMetrics;
}
export async function delayTrends() {
  if (cache.delayTrends === undefined) cache.delayTrends = await readJson<DelayTrends>("delay_trends.json");
  return cache.delayTrends;
}
export async function delayFailureCases() {
  if (cache.delayFailures === undefined) {
    const raw = await readJson<FailureCase[] | { failure_cases: FailureCase[] }>("delay_failure_cases.json");
    cache.delayFailures = raw ? (Array.isArray(raw) ? raw : raw.failure_cases) : null;
  }
  return cache.delayFailures;
}

export const HORIZONS = [3, 6, 9, 12] as const;
