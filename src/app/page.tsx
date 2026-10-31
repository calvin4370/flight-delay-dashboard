import Link from "next/link";
import {
  aarForecast, aarIndex, aarMetrics, delayFailureCases, delayFlights, delayMetrics, delayTrends, HORIZONS,
  type AarHour, type FailureCase, type Factor, type RateRow,
} from "@/lib/data";
import { aarRules, delayRules, RULE_TEXT, RULES_STATUS, type Recommendation } from "@/lib/rules";
import Briefing from "./briefing";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const VIEWS = [
  ["risk", "Risk board"],
  ["aar", "AAR forecast"],
  ["trends", "Historical trends"],
  ["performance", "Model performance"],
] as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  // All sources start together (async-parallel); each file is parsed once per server process.
  const [forecast, index, metrics] = await Promise.all([aarForecast(), aarIndex(), aarMetrics()]);
  const airports = index?.airports ?? [];
  const view = one(sp.view) ?? "risk";
  const airport = one(sp.airport) ?? airports[0] ?? "ATL";
  const horizon = Number(one(sp.h) ?? 3);
  const dates = index?.dates.get(airport) ?? [];
  const failureDays = (metrics?.failure_cases ?? []).filter((f) => f.airport === airport).map((f) => f.time_utc.slice(0, 10));
  const date = one(sp.date) ?? failureDays[0] ?? dates[0] ?? "";
  const day = index?.day.get(`${airport}|${horizon}|${date}`) ?? [];
  const q = (o: Record<string, string | number>) =>
    "/?" + new URLSearchParams({ view, airport, date, h: String(horizon), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 text-sm">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-300 pb-3 dark:border-neutral-700">
        <div>
          <h1 className="text-xl font-semibold">Airport Capacity &amp; Delay Risk: TMC decision support</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Forecasts 3–12 h ahead from weather observed at least 3 h earlier. Advisory only: the Traffic Management Coordinator makes the call.
          </p>
        </div>
        <p className="text-xs text-neutral-500">
          AAR model: {forecast?.selected_model ?? "not exported"} · generated {forecast?.generated_utc ?? "n/a"}
        </p>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={q({ view: v })}
            className={`rounded px-3 py-1.5 ${view === v ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : "bg-neutral-100 dark:bg-neutral-800"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {(view === "risk" || view === "aar") && (
        <form className="mb-4 flex flex-wrap items-end gap-3" action="/">
          <input type="hidden" name="view" value={view} />
          <label className="flex flex-col">Airport
            <select name="airport" defaultValue={airport} className="rounded border px-2 py-1 dark:bg-neutral-900">
              {airports.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col">Local date (test period)
            <input type="date" name="date" defaultValue={date} min={dates[0]} max={dates.at(-1)} className="rounded border px-2 py-1 dark:bg-neutral-900" />
          </label>
          <label className="flex flex-col">Hours ahead
            <select name="h" defaultValue={horizon} className="rounded border px-2 py-1 dark:bg-neutral-900">
              {HORIZONS.map((h) => <option key={h} value={h}>{h} h</option>)}
            </select>
          </label>
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-white dark:bg-white dark:text-black">Show</button>
          {failureDays.length > 0 && (
            <span className="text-xs text-neutral-500">
              Known failure days: {failureDays.map((d) => <Link key={d} href={q({ date: d })} className="mr-2 underline">{d}</Link>)}
            </span>
          )}
        </form>
      )}

      {!forecast && <Missing what="data/outputs/aar_forecast.json" />}
      {view === "risk" && forecast && <RiskBoard day={day} airport={airport} date={date} horizon={horizon} />}
      {view === "aar" && forecast && <AarView day={day} />}
      {view === "trends" && <Trends rates={index?.rates ?? null} />}
      {view === "performance" && <Performance />}

      <footer className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-500 dark:border-neutral-700">
        Assumptions: AAR proxy = realised wheels-on arrivals per hour (BTS), not the FAA declared rate · runway headings ATL 80°, DFW 180° (brief) ·
        weather observations only, no forecasts · cancelled/diverted flights are not arrivals · flights in the repeated autumn DST hour are dropped (D43).
        Data: BTS On-Time Reporting; Meteostat hourly (NOAA ISD), stations 72219 / 72259.
      </footer>
    </main>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="rounded border border-dashed p-3 text-neutral-500">Not available yet: {what} has not been exported. Nothing is shown in its place.</p>;
}

function Factors({ factors }: { factors: Factor[] }) {
  return (
    <ul className="space-y-0.5">
      {factors.map((f) => (
        <li key={f.feature} className="text-xs">
          <span className={(f.shap ?? 0) < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}>
            {(f.shap ?? 0) > 0 ? "+" : ""}{f.shap?.toFixed(1)}
          </span>{" "}
          {f.label} = {String(f.value ?? "n/a")}
          {f.observed_utc && <span className="text-neutral-500"> · obs {f.observed_utc.slice(0, 16).replace("T", " ")}Z</span>}
        </li>
      ))}
    </ul>
  );
}

function Recs({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return <p className="text-neutral-500">No rule fired.</p>;
  const tone = {
    high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  };
  return (
    <ul className="space-y-3">
      {recs.map((r, i) => (
        <li key={i} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="mb-1"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone[r.severity]}`}>{r.severity === "high" ? "Act" : r.severity === "medium" ? "Watch" : "Check"}</span></p>
          <p className="font-medium">{r.title}</p>
          <p>{r.action}</p>
          <p className="text-xs text-neutral-500">Rule fired: {r.rule}</p>
          <ul className="text-xs text-neutral-500">{r.evidence.map((e, j) => <li key={j}>· {e}</li>)}</ul>
        </li>
      ))}
    </ul>
  );
}

async function RiskBoard({ day, airport, date, horizon }: { day: AarHour[]; airport: string; date: string; horizon: number }) {
  const df = await delayFlights();
  const flights = (df?.flights ?? []).filter((f) => f.airport === airport && f.horizon_h === horizon && f.sched_local.startsWith(date));
  const recs = [...day.flatMap(aarRules), ...delayRules(flights)];
  const order = { high: 0, medium: 1, info: 2 };
  recs.sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section>
        <h2 className="mb-1 font-semibold">{airport} {date}: hourly arrival forecast, {horizon} h ahead</h2>
        <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
          Shaded rows: forecast below 85% of scheduled arrivals (rule R1). Factors show each input&apos;s effect on the forecast in arrivals (SHAP) and when the weather was observed.
        </p>
        {day.length === 0 ? <p>No forecast for this day.</p> : (
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-neutral-500">
              <tr><th>Local hour</th><th>Scheduled</th><th>Forecast (80% range)</th><th>Actual</th><th>Why (top factors, SHAP)</th></tr>
            </thead>
            <tbody>
              {day.map((h) => {
                const short = h.scheduled_arrivals > 0 && h.predicted_arrivals < 0.85 * h.scheduled_arrivals;
                return (
                  <tr key={h.time_utc} className={`border-t border-neutral-200 align-top dark:border-neutral-800 ${short ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                    <td className="py-1 font-mono">{h.time_local.slice(11, 16)}</td>
                    <td>{h.scheduled_arrivals}</td>
                    <td>{h.predicted_arrivals.toFixed(0)} <span className="text-neutral-500">({h.interval_low.toFixed(0)}–{h.interval_high.toFixed(0)})</span></td>
                    <td>{h.actual_arrivals ?? "n/a"}</td>
                    <td><Factors factors={h.top_factors} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <h2 className="mb-2 mt-6 font-semibold">Flights at severe-delay risk (&gt; 45 min), {horizon} h ahead</h2>
        {!df ? <Missing what="data/outputs/delay_flights.json" /> : flights.length === 0 ? <p>No flights in the sample for this day.</p> : (
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-neutral-500">
              <tr><th>Sched local</th><th>Flight</th><th>Route</th><th>Risk</th><th>Alert</th><th>Actual</th><th>Why</th></tr>
            </thead>
            <tbody>
              {[...flights].sort((a, b) => b.risk - a.risk).map((f) => (
                <tr key={f.flight_id + f.horizon_h} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="py-1 font-mono">{f.sched_local.slice(11, 16)}</td>
                  <td>{f.carrier}{f.flight_number}</td>
                  <td>{f.origin}→{f.dest}</td>
                  <td>{(f.risk * 100).toFixed(0)}%</td>
                  <td>{f.alert && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">Alert</span>}</td>
                  <td>{f.actual_severe == null ? "n/a" : f.actual_severe ? "severe" : "ok"}</td>
                  <td><Factors factors={f.top_factors ?? []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <aside className="space-y-6">
        <section>
          <h2 className="mb-1 font-semibold">Recommendations</h2>
          <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Fixed rules · {RULES_STATUS}. Advisory: the TMC decides.</p>
          <Recs recs={recs} />
        </section>
        <Briefing airport={airport} date={date} horizon={horizon} />
      </aside>
    </div>
  );
}

function AarView({ day }: { day: AarHour[] }) {
  if (day.length === 0) return <p>No forecast for this day.</p>;
  const max = Math.max(...day.flatMap((h) => [h.scheduled_arrivals, h.interval_high, h.actual_arrivals ?? 0])) || 1;
  const W = 760, H = 260, bw = W / day.length, y = (v: number) => H - (v / max) * (H - 20);
  return (
    <section>
      <h2 className="mb-2 font-semibold">Arrivals per hour: forecast with 80% range vs scheduled, baseline, SARIMAX and actual</h2>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full max-w-4xl">
        {day.map((h, i) => (
          <g key={h.time_utc}>
            <rect x={i * bw + 2} y={y(h.scheduled_arrivals)} width={bw - 4} height={H - y(h.scheduled_arrivals)} className="fill-neutral-200 dark:fill-neutral-800" />
            <rect x={i * bw + bw / 2 - 3} y={y(h.interval_high)} width={6} height={Math.max(1, y(h.interval_low) - y(h.interval_high))} className="fill-sky-300/70" />
            <circle cx={i * bw + bw / 2} cy={y(h.predicted_arrivals)} r={3} className="fill-sky-700" />
            {h.baseline_arrivals != null && <line x1={i * bw + 4} x2={(i + 1) * bw - 4} y1={y(h.baseline_arrivals)} y2={y(h.baseline_arrivals)} className="stroke-neutral-500" strokeDasharray="3 2" />}
            {h.actual_arrivals != null && <circle cx={i * bw + bw / 2} cy={y(h.actual_arrivals)} r={3} className="fill-red-600" />}
            <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="fill-neutral-500 text-[9px]">{h.time_local.slice(11, 13)}</text>
          </g>
        ))}
      </svg>
      <p className="text-xs text-neutral-500">Grey bar: scheduled · blue dot + band: model forecast and 80% range · dashed: baseline (D22) · red dot: actual.</p>
      <table className="mt-4 w-full max-w-4xl border-collapse text-xs tabular-nums">
        <thead className="text-left text-neutral-500"><tr><th>Hour</th><th>Scheduled</th><th>Baseline</th><th>SARIMAX</th><th>Model</th><th>80% range</th><th>Actual</th></tr></thead>
        <tbody>{day.map((h) => (
          <tr key={h.time_utc} className="border-t border-neutral-200 dark:border-neutral-800">
            <td className="font-mono">{h.time_local.slice(11, 16)}</td><td>{h.scheduled_arrivals}</td><td>{h.baseline_arrivals?.toFixed(0) ?? "n/a"}</td>
            <td>{h.sarimax_arrivals?.toFixed(0) ?? "n/a"}</td><td>{h.predicted_arrivals.toFixed(0)}</td>
            <td>{h.interval_low.toFixed(0)}–{h.interval_high.toFixed(0)}</td><td>{h.actual_arrivals ?? "n/a"}</td>
          </tr>))}
        </tbody>
      </table>
    </section>
  );
}

async function Trends({ rates }: { rates: { month: RateRow[]; hour: RateRow[] } | null }) {
  const trends = await delayTrends();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["month", "hour"] as const).map((kind) => (
        <section key={kind}>
          <h2 className="mb-2 font-semibold">Arrivals landed as a share of scheduled, by {kind === "month" ? "month" : "local hour"}</h2>
          {rates ? <RateBars rows={rates[kind]} /> : <Missing what="data/outputs/aar_forecast.json" />}
        </section>
      ))}
      <section className="lg:col-span-2">
        <h2 className="mb-2 font-semibold">Severe-delay rate (share of flights &gt; 45 min late)</h2>
        {!trends ? <Missing what="data/outputs/delay_trends.json" /> : <GenericTables data={trends} />}
      </section>
    </div>
  );
}

function RateBars({ rows }: { rows: RateRow[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {rows.map((r) => (
        <li key={r.airport + r.key} className="flex items-center gap-2">
          <span className="w-20 font-mono">{r.key}</span><span className="w-8">{r.airport}</span>
          <span className="h-3 bg-sky-600" style={{ width: `${Math.min(100, r.rate * 100) * 2}px` }} />
          <span>{(r.rate * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

function GenericTables({ data }: { data: unknown }) {
  // delay_* files are Calvin's (D41); render whatever tables they contain without reshaping numbers.
  if (Array.isArray(data)) {
    const cols = [...new Set(data.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
    return (
      <table className="mb-4 w-full border-collapse text-xs tabular-nums">
        <thead className="text-left text-neutral-500"><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{data.slice(0, 200).map((r, i) => (
          <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
            {cols.map((c) => { const v = (r as Record<string, unknown>)[c]; return <td key={c}>{typeof v === "number" ? (Math.abs(v) < 1 && v !== 0 ? v.toFixed(3) : String(v)) : typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}</td>; })}
          </tr>))}
        </tbody>
      </table>
    );
  }
  if (data && typeof data === "object") {
    return (
      <div>{Object.entries(data as Record<string, unknown>).filter(([k]) => !["generated_utc", "source", "split"].includes(k)).map(([k, v]) => (
        <div key={k} className="mb-2"><h3 className="text-xs font-semibold">{k}</h3>
          {v && typeof v === "object" ? <GenericTables data={v} /> : <p className="text-xs">{String(v)}</p>}
        </div>))}
      </div>
    );
  }
  return <p className="text-xs">{String(data)}</p>;
}

function Failures({ cases }: { cases: FailureCase[] }) {
  return (
    <ul className="space-y-3">
      {cases.map((f, i) => (
        <li key={i} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">{f.airport} {f.time_utc}: {f.what_happened}</p>
          <p className="text-xs">Predicted {String(f.predicted)} · actual {String(f.actual)}</p>
          <p className="text-xs"><b>Why:</b> {f.reason}</p>
          <p className="text-xs"><b>How the TMC knows:</b> {f.how_user_knows}</p>
        </li>
      ))}
    </ul>
  );
}

async function Performance() {
  const [m, dm, dfc] = await Promise.all([aarMetrics(), delayMetrics(), delayFailureCases()]);
  const keys = m ? Object.keys(m.baseline.test_rmse) : [];
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 font-semibold">AAR regressor: RMSE in arrivals per hour (lower is better)</h2>
        {!m ? <Missing what="data/outputs/aar_metrics.json" /> : (
          <>
            <p className="mb-2 text-xs text-neutral-500">
              Train {m.split.train.join(" – ")} · validation {m.split.validation.join(" – ")} · test {m.split.test.join(" – ")} ({m.test_rows.toLocaleString()} rows).
              Selected: <b>{m.selected_model}</b> on {m.selected_on}. {m.selection_note}
            </p>
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead className="text-left text-neutral-500"><tr><th>Model</th><th>Validation</th>{keys.map((k) => <th key={k}>Test {k}</th>)}</tr></thead>
              <tbody>{[m.baseline, ...m.models].map((mod) => (
                <tr key={mod.name} className={`border-t border-neutral-200 dark:border-neutral-800 ${mod.name === m.selected_model ? "font-semibold" : ""}`}>
                  <td>{mod.name}</td><td>{mod.validation_rmse.toFixed(2)}</td>{keys.map((k) => <td key={k}>{mod.test_rmse[k]?.toFixed(2)}</td>)}
                </tr>))}
              </tbody>
            </table>
            <p className="mt-2 text-xs">
              Improvement over baseline on test: {(100 * (1 - (m.models.find((x) => x.name === m.selected_model)?.test_rmse.all ?? 0) / m.baseline.test_rmse.all)).toFixed(0)}% lower RMSE
              (measured). Uncertainty: 80% range per horizon from validation errors.
            </p>
            <h3 className="mb-2 mt-4 font-semibold">AAR failure cases (largest misses, 3 h ahead)</h3>
            <Failures cases={m.failure_cases} />
          </>
        )}
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Delay classifier (&gt; 45 min): precision, recall, confusion matrix</h2>
        {!dm ? <Missing what="data/outputs/delay_metrics.json" /> : <GenericTables data={dm} />}
        {dfc && <><h3 className="mb-2 mt-4 font-semibold">Delay failure cases</h3><Failures cases={dfc} /></>}
      </section>
      <section className="text-xs text-neutral-500">
        <h3 className="font-semibold">Recommendation rules ({RULES_STATUS})</h3>
        <ul>{RULE_TEXT.map((t) => <li key={t}>· {t}</li>)}</ul>
      </section>
    </div>
  );
}
