import Link from "next/link";
import {
  aarForecast, aarIndex, aarMetrics, delayFailureCases, delayIndex, delayMetrics, delayTrends, HORIZONS,
  type AarHour, type DelayMetrics, type DelayModel, type DelayScores, type DelayTrends, type FailureCase, type Factor,
  type RateRow, type TrendCell,
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
            className={`rounded px-3 py-1.5 transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none ${view === v ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"}`}>
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
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-white transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none dark:bg-white dark:text-black">Show</button>
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

      <Assumptions />
    </main>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="rounded border border-dashed p-3 text-neutral-500">Not available yet: {what} has not been exported. Nothing is shown in its place.</p>;
}

// unit "arrivals": SHAP in arrivals per hour, fewer is worse. unit "pp": SHAP in risk percentage points, more is worse.
function Factors({ factors, unit = "arrivals" }: { factors: Factor[]; unit?: "arrivals" | "pp" }) {
  return (
    <ul className="space-y-0.5">
      {factors.map((f) => {
        const v = (f.shap ?? 0) * (unit === "pp" ? 100 : 1);
        const bad = unit === "pp" ? v > 0 : v < 0;
        return (
        <li key={f.feature} className="text-xs">
          <span className={bad ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
            {v > 0 ? "+" : ""}{v.toFixed(1)}{unit === "pp" ? " pp" : ""}
          </span>{" "}
          {f.label} = {String(f.value ?? "n/a")}
          {f.observed_utc && <span className="text-neutral-500"> · obs {f.observed_utc.slice(0, 16).replace("T", " ")}Z</span>}
        </li>
        );
      })}
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
  const di = await delayIndex();
  const flights = di?.day.get(`${airport}|${horizon}|${date}`) ?? [];
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
        {di && (
          <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
            Model {di.model} · alert when risk ≥ {(di.threshold * 100).toFixed(1)}% (max F1 on validation, D21) · typical = historical
            severe rate for the same airport, direction, hour and month (D22). Factors: effect on risk in percentage points.
          </p>
        )}
        {!di ? <Missing what="data/outputs/delay_flights.json" /> : flights.length === 0 ? <p>No sampled flights at this airport on this day.</p> : (
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-neutral-500">
              <tr><th>Sched local</th><th>Flight</th><th>Route</th><th>Risk vs alert line</th><th>Typical</th><th>Actual</th><th>Why (top factors)</th></tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.flight_id + f.horizon_h} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="py-1 font-mono">{f.sched_local.slice(11, 16)}</td>
                  <td>{f.carrier}{f.flight_number}</td>
                  <td>{f.origin}→{f.dest}</td>
                  <td>
                    <RiskBar risk={f.risk} threshold={di.threshold} />
                    {f.alert && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">Alert</span>}
                  </td>
                  <td>{f.baseline_rate == null ? "n/a" : `${(f.baseline_rate * 100).toFixed(0)}%`}</td>
                  <td>{f.actual_severe == null ? "n/a" : f.actual_severe ? "severe" : "under 45 min"}</td>
                  <td><Factors factors={f.top_factors ?? []} unit="pp" /></td>
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
        {!trends ? <Missing what="data/outputs/delay_trends.json" /> : <DelayTrendCharts trends={trends} />}
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
        {!dm ? <Missing what="data/outputs/delay_metrics.json" /> : <DelayPerformance m={dm} />}
        {(dfc ?? dm?.failure_cases) && <><h3 className="mb-2 mt-4 font-semibold">Delay failure cases</h3><Failures cases={(dfc ?? dm?.failure_cases)!} /></>}
      </section>
      <section className="text-xs text-neutral-500">
        <h3 className="font-semibold">Recommendation rules ({RULES_STATUS})</h3>
        <ul>{RULE_TEXT.map((t) => <li key={t}>· {t}</li>)}</ul>
      </section>
    </div>
  );
}

const pct = (x: number | undefined, d = 1) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`);

function RiskBar({ risk, threshold }: { risk: number; threshold: number }) {
  // Risk on a 0-50% track with the alert line marked: how far above or below the line a flight sits.
  const scale = (x: number) => `${Math.min(100, (x / 0.5) * 100)}%`;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="relative inline-block h-2 w-20 rounded-sm bg-neutral-200 dark:bg-neutral-800">
        <span className={`absolute inset-y-0 left-0 rounded-sm ${risk >= threshold ? "bg-red-600" : "bg-neutral-500"}`} style={{ width: scale(risk) }} />
        <span className="absolute -inset-y-0.5 w-px bg-neutral-900 dark:bg-white" style={{ left: scale(threshold) }} title="alert threshold" />
      </span>
      <span>{pct(risk, 0)}</span>
    </span>
  );
}

function Assumptions() {
  // Mirrors PLAN.md "Assumptions to state in the demo".
  const items = [
    "Runway headings ATL 80°, DFW 180° (brief); other airports: most common runway direction from OurAirports.",
    "Flights in the repeated autumn daylight-saving hour are dropped (D43).",
    "AAR proxy = realised arrival throughput from BTS (wheels-on per hour), not the FAA's declared rate (D8); cancelled and diverted flights are not arrivals.",
    "AAR features use scheduled arrivals for the target hour, known in advance from the published schedule (D34).",
    "Weather observations only, no forecasts (D13); every input is at least 3 h older than the scheduled time (D4).",
    "Test period Jul 2024 – Jul 2025 (D11), models trained on 2023 only. Advisory tool: the Traffic Management Coordinator makes every decision.",
  ];
  return (
    <section className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
      <h2 className="mb-1 font-semibold text-neutral-900 dark:text-neutral-100">Assumptions</h2>
      <ul className="grid gap-x-6 gap-y-0.5 md:grid-cols-2">{items.map((t) => <li key={t}>· {t}</li>)}</ul>
      <p className="mt-2">Data: BTS On-Time Reporting (US DOT); Meteostat hourly observations (NOAA ISD), stations 72219 ATL / 72259 DFW; OurAirports.</p>
    </section>
  );
}

function DelayTrendCharts({ trends }: { trends: DelayTrends }) {
  const dims = [
    ["month", "Month"], ["local_hour", "Scheduled local hour"], ["weather_group", "Weather in the scheduled hour"],
  ] as const;
  const groups = [...new Set(trends.severe_rate.month.map((c) => `${c.airport} ${c.direction}`))].sort();
  return (
    <div>
      <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">{trends.note}. Period {trends.period.join(" – ")}.</p>
      {dims.map(([dim, title]) => {
        const cells = trends.severe_rate[dim];
        const max = Math.max(...cells.map((c) => c.rate), 0.01);
        return (
          <div key={dim} className="mb-5">
            <h3 className="mb-1 text-xs font-semibold">{title}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {groups.map((g) => (
                <div key={g}>
                  <p className="mb-1 text-xs font-medium">{g}</p>
                  <ul className="space-y-px text-[11px] tabular-nums">
                    {cells.filter((c: TrendCell) => `${c.airport} ${c.direction}` === g).map((c: TrendCell) => (
                      <li key={String(c[dim])} className="flex items-center gap-1.5" title={`${c.n} flights`}>
                        <span className="w-14 truncate text-neutral-500">{String(c[dim])}</span>
                        <span className={`h-2.5 ${c.n < 30 ? "bg-neutral-300 dark:bg-neutral-700" : "bg-sky-700"}`} style={{ width: `${(c.rate / max) * 90}px` }} />
                        <span>{pct(c.rate)}</span>
                        <span className="text-neutral-500">n={c.n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-neutral-500">Light bars: fewer than 30 flights; treat as unreliable.</p>
    </div>
  );
}

function ScoreRow({ name, s, bold }: { name: string; s: DelayScores; bold?: boolean }) {
  return (
    <tr className={`border-t border-neutral-200 dark:border-neutral-800 ${bold ? "font-semibold" : ""}`}>
      <td>{name}</td>
      <td>{s.pr_auc?.toFixed(3) ?? "n/a"}</td>
      <td>{pct(s.precision)}</td>
      <td>{pct(s.recall)}</td>
      <td>{s.f1?.toFixed(3) ?? "n/a"}</td>
      <td>{pct(s.accuracy)}</td>
      <td>{s.confusion_matrix ? `${s.confusion_matrix.tp} / ${s.confusion_matrix.fp} / ${s.confusion_matrix.fn} / ${s.confusion_matrix.tn}` : "n/a"}</td>
      <td>{s.positives ?? "n/a"} / {s.rows ?? "n/a"}</td>
    </tr>
  );
}

function DelayPerformance({ m }: { m: DelayMetrics }) {
  const sel = m.models.find((x) => x.name === m.selected_model) as DelayModel | undefined;
  const head = (
    <tr><th>Model</th><th>PR-AUC</th><th>Precision</th><th>Recall</th><th>F1</th><th>Accuracy</th><th>TP / FP / FN / TN</th><th>Severe / flights</th></tr>
  );
  const shap = Object.entries(m.mean_abs_shap_top15 ?? {}).slice(0, 8);
  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        {m.target}. Selected <b>{m.selected_model}</b> on {m.selected_on}; alert threshold {pct(m.threshold)} ({m.threshold_rule}).
        Test {m.split.test.join(" – ")}. About 1 in 9 flights is severe, so accuracy alone misleads: read precision and recall.
      </p>
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="text-left text-neutral-500">{head}</thead>
        <tbody>
          <ScoreRow name={`baseline (${m.baseline.name})`} s={m.baseline} />
          {m.models.map((x) => <ScoreRow key={x.name} name={x.name} s={x} bold={x.name === m.selected_model} />)}
        </tbody>
      </table>
      {sel?.by_airport_direction && (
        <>
          <h3 className="text-xs font-semibold">{sel.name} by airport and direction (test)</h3>
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead className="text-left text-neutral-500">{head}</thead>
            <tbody>{Object.entries(sel.by_airport_direction).map(([k, v]) => <ScoreRow key={k} name={k} s={v} />)}</tbody>
          </table>
        </>
      )}
      {sel?.by_horizon && (
        <>
          <h3 className="text-xs font-semibold">{sel.name} by hours ahead (test)</h3>
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead className="text-left text-neutral-500">{head}</thead>
            <tbody>{Object.entries(sel.by_horizon).map(([k, v]) => <ScoreRow key={k} name={`${k} h`} s={v} />)}</tbody>
          </table>
        </>
      )}
      {shap.length > 0 && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Strongest inputs on average (mean |SHAP|, risk points): {shap.map(([k, v]) => `${k} ${(v * 100).toFixed(1)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
