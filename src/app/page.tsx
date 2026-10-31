import Link from "next/link";
import { Fragment } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aarIndex, aarMetrics, delayFailureCases, delayIndex, delayMetrics, delayTrends, HORIZONS,
  type AarHour, type DelayFlight, type DelayMetrics, type DelayScores, type DelayTrends, type FailureCase, type Factor,
  type RateRow,
} from "@/lib/data";
import { aarRules, delayRules, RULE_TEXT, type Recommendation } from "@/lib/rules";
import Briefing from "./briefing";

// D45: four tabs, main target first. Delay risk (main target) · Arrival capacity (AAR bonus) · Historical trends · Model evidence.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
type View = "delay" | "aar" | "trends" | "evidence";
const VIEWS: [View, string][] = [
  ["delay", "1 · Delay risk"],
  ["aar", "2 · Arrival capacity"],
  ["trends", "3 · Historical trends"],
  ["evidence", "4 · Model evidence"],
];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pct = (x: number | undefined | null, d = 0) => (x == null ? "–" : `${(x * 100).toFixed(d)}%`);
const fmt = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}Z`;

type HourRow = {
  key: string;
  hour: string;
  aar?: AarHour;
  flights: DelayFlight[];
  recs: Recommendation[];
  status: "act" | "watch" | "normal";
};

export default async function Page({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const [index, di, metrics, dfc] = await Promise.all([aarIndex(), delayIndex(), aarMetrics(), delayFailureCases()]);
  const airports = index?.airports ?? ["ATL", "DFW"];
  const requested = one(sp.view) as View | undefined;
  const view: View = VIEWS.some(([v]) => v === requested) ? requested! : "delay";
  const airport = airports.includes(one(sp.airport) ?? "") ? one(sp.airport)! : airports[0];
  const horizon = (HORIZONS as readonly number[]).includes(Number(one(sp.h))) ? Number(one(sp.h)) : 3;
  const dates = index?.dates.get(airport) ?? [];
  const cases = [...(dfc ?? []), ...(metrics?.failure_cases ?? [])];
  const notable = [...new Set(cases.filter((f) => f.airport === airport).map((f) => f.time_utc.slice(0, 10)))].sort();
  const date = dates.includes(one(sp.date) ?? "") ? one(sp.date)! : (notable[0] ?? dates[0] ?? "");
  const href = (v: View) => "/?" + new URLSearchParams({ view: v, airport, date, h: String(horizon) });

  const hours = index?.day.get(`${airport}|${horizon}|${date}`) ?? [];
  const flights = di?.day.get(`${airport}|${horizon}|${date}`) ?? [];
  const threshold = di?.threshold ?? null;
  const rows = hourRows(hours, flights);
  const actions = rows.flatMap((r) => r.recs.filter((x) => x.severity !== "info").map((x) => ({ ...x, hour: r.hour })));

  return (
    <div className="min-h-full bg-[var(--surface)]">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Airport Delay Risk &amp; Arrival Capacity: ATL / DFW</h1>
            <p className="text-xs text-[var(--muted)]">
              For the Traffic Management Coordinator · warnings 3–12 h ahead · advisory only, the coordinator decides
            </p>
          </div>
          <nav className="flex flex-wrap rounded-md border border-[var(--line)] p-0.5 text-sm" aria-label="Views">
            {VIEWS.map(([v, label]) => (
              <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined}
                className={`press rounded px-3 py-1 ${view === v ? "bg-[var(--ink)] text-[var(--panel)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5 text-sm">
        <p className="mb-4 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]">
          <b className="text-[var(--ink)]">Replay of the test year (Jul 2024 – Jul 2025).</b> Every prediction uses only the published schedule and
          weather observed at least <i>h</i> hours before the flight or hour (the lead time you choose). &ldquo;Actual&rdquo; is what really happened,
          so you can check each warning. Flights come from the challenge&apos;s flight file, a ~1% sample of real US flights.
        </p>

        {(view === "delay" || view === "aar") && (
          <>
            <Controls view={view} airport={airport} airports={airports} date={date} dates={dates} horizon={horizon} notable={notable} />
            <RunwayWind airport={airport} date={date} />
          </>
        )}

        {view === "delay" && (
          <WithSide actions={actions} airport={airport} date={date} horizon={horizon}>
            {di ? <DelayRisk flights={flights} threshold={threshold!} model={di.model} airport={airport} date={date} horizon={horizon} />
              : <Missing what="delay_flights.json" />}
          </WithSide>
        )}
        {view === "aar" && (
          <WithSide actions={actions} airport={airport} date={date} horizon={horizon}>
            {index ? <ArrivalCapacity rows={rows} hours={hours} airport={airport} date={date} horizon={horizon} model={metrics?.selected_model} threshold={threshold} />
              : <Missing what="aar_forecast.json" />}
          </WithSide>
        )}
        {view === "trends" && <Trends rates={index?.rates ?? null} />}
        {view === "evidence" && <Evidence cases={cases} />}
        <Assumptions />
      </main>
    </div>
  );
}

function hourRows(hours: AarHour[], flights: DelayFlight[]): HourRow[] {
  const byHour = new Map<string, HourRow>();
  for (const h of hours) {
    const hh = h.time_local.slice(11, 13);
    byHour.set(hh, { key: hh, hour: `${hh}:00`, aar: h, flights: [], recs: [], status: "normal" });
  }
  for (const f of flights) {
    const hh = f.sched_local.slice(11, 13);
    const row = byHour.get(hh) ?? { key: hh, hour: `${hh}:00`, flights: [], recs: [], status: "normal" as const };
    row.flights.push(f);
    byHour.set(hh, row);
  }
  const rows = [...byHour.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const r of rows) {
    r.recs = [...(r.aar ? aarRules(r.aar) : []), ...delayRules(r.flights)];
    r.status = r.recs.some((x) => x.severity === "high") ? "act" : r.recs.some((x) => x.severity === "medium") ? "watch" : "normal";
  }
  return rows;
}

/* ------------------------------------------------------------------ shared controls + side panel */

function Controls(props: { view: View; airport: string; airports: string[]; date: string; dates: string[]; horizon: number; notable: string[] }) {
  const { view, airport, airports, date, dates, horizon, notable } = props;
  return (
    <form action="/" className="mb-5 flex flex-wrap items-end gap-x-5 gap-y-3">
      <input type="hidden" name="view" value={view} />
      <Field label="Airport">
        <select name="airport" defaultValue={airport} className="control">{airports.map((a) => <option key={a}>{a}</option>)}</select>
      </Field>
      <Field label="Day (local)">
        <input type="date" name="date" defaultValue={date} min={dates[0]} max={dates.at(-1)} className="control" />
      </Field>
      <Field label="Lead time (forecast issued)">
        <select name="h" defaultValue={horizon} className="control">{HORIZONS.map((h) => <option key={h} value={h}>{h} h ahead</option>)}</select>
      </Field>
      <button className="press control bg-[var(--ink)] text-[var(--panel)]">Show</button>
      {notable.length > 0 && (
        <p className="text-xs text-[var(--muted)]">
          Known failure days:{" "}
          {notable.map((d) => <Link key={d} href={`/?view=${view}&airport=${airport}&date=${d}&h=${horizon}`} className="mr-2 underline underline-offset-2">{d}</Link>)}
        </p>
      )}
    </form>
  );
}

function WithSide({ children, actions, airport, date, horizon }: {
  children: React.ReactNode; actions: (Recommendation & { hour: string })[]; airport: string; date: string; horizon: number;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>{children}</div>
      <aside className="space-y-6">
        <section aria-labelledby="actions">
          <h2 id="actions" className="mb-1 text-base font-semibold">Recommended actions</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">Fixed rules (D36) on both models&apos; outputs for this day. Advisory: the coordinator decides.</p>
          {actions.length === 0 ? (
            <p className="text-[var(--muted)]">No rule fired for this day. Keep the planned rates.</p>
          ) : (
            <ol className="space-y-2">
              {actions.map((a, i) => (
                <li key={i} className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
                  <p className="mb-1 flex items-center gap-2 text-xs"><StatusChip s={a.severity === "high" ? "act" : "watch"} /><span className="font-mono">{a.hour}</span></p>
                  <p>{a.action}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Rule {a.rule} · {a.evidence.slice(0, 2).join(" · ")}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <Briefing key={`${airport}-${date}-${horizon}`} airport={airport} date={date} horizon={horizon} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ 1 · Delay risk (main target) */

function DelayRisk({ flights, threshold, model, airport, date, horizon }: {
  flights: DelayFlight[]; threshold: number; model?: string; airport: string; date: string; horizon: number;
}) {
  const alerts = flights.filter((f) => f.alert);
  const severe = flights.filter((f) => f.actual_severe);
  const caught = alerts.filter((f) => f.actual_severe).length;
  return (
    <section aria-labelledby="delay">
      <h2 id="delay" className="text-base font-semibold">{airport} · {date} · flights at risk of a delay over 45 min, forecast {horizon} h ahead</h2>
      <p className="mb-3 text-xs text-[var(--muted)]">
        <b className="text-[var(--ink)]">Delay model ({model ?? "random forest"}, main target).</b> For each departure from and arrival into {airport}:
        the chance it ends up more than 45 min late. A flight is flagged when its risk reaches the alert line ({pct(threshold, 1)}, chosen on validation).
        &ldquo;Historical rate&rdquo; is the 2023 severe-delay rate for the same airport, direction, hour and month (the baseline).
      </p>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <Stat label="Flights in the sample" value={flights.length} />
        <Stat label="Flagged by the model" value={alerts.length} tone="act" />
        <Stat label="Actually > 45 min late" value={severe.length} />
        <Stat label="Flagged and late" value={`${caught} of ${severe.length}`} />
      </div>
      {flights.length === 0 ? <p className="text-[var(--muted)]">No flights in the sample for this day.</p> : (
        <div className="overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--panel)]">
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-[var(--muted)]">
              <tr>{["Sched (local)", "Flight", "Route", "Risk vs alert line", "Historical rate", "Actual", "Why (top factors: effect on risk; weather observation time)"]
                .map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={`${f.flight_id}-${f.horizon_h}`} className={`border-t border-[var(--line)] align-top ${f.alert ? "bg-[var(--act-bg)]/40" : ""}`}>
                  <td className="px-3 py-1.5 font-mono tabular-nums">{f.sched_local.slice(11, 16)}</td>
                  <td className="px-3 py-1.5 font-medium">{f.carrier}{f.flight_number}<span className="block text-[var(--muted)]">{f.direction}</span></td>
                  <td className="px-3 py-1.5">{f.origin}→{f.dest}</td>
                  <td className="px-3 py-1.5"><RiskBar risk={f.risk} threshold={threshold} />{f.alert && <span className="ml-1 font-semibold text-[var(--act)]">flagged</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{pct(f.baseline_rate)}</td>
                  <td className="px-3 py-1.5">{f.actual_severe == null ? "–" : f.actual_severe ? <b className="text-[var(--act)]">&gt; 45 min</b> : "≤ 45 min"}</td>
                  <td className="px-3 py-1.5"><Factors factors={f.top_factors ?? []} unit="pp" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">Sorted by risk. Red rows are flagged. A flagged flight that was not late is a false alarm; a late flight that was not flagged is a miss.</p>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "act" }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "act" ? "text-[var(--act)]" : ""}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ 2 · Arrival capacity (AAR bonus) */

function ArrivalCapacity({ rows, hours, airport, date, horizon, model, threshold }: {
  rows: HourRow[]; hours: AarHour[]; airport: string; date: string; horizon: number; model?: string; threshold: number | null;
}) {
  const act = rows.filter((r) => r.status === "act").length;
  const watch = rows.filter((r) => r.status === "watch").length;
  const max = Math.max(1, ...hours.map((h) => Math.max(h.scheduled_arrivals, h.interval_high, h.actual_arrivals ?? 0)));
  return (
    <section aria-labelledby="timeline">
      <h2 id="timeline" className="text-base font-semibold">{airport} · {date} · arrivals per hour, forecast {horizon} h ahead</h2>
      <p className="mb-3 text-xs text-[var(--muted)]">
        <b className="text-[var(--ink)]">Arrival model ({model ?? "LightGBM"}, optional bonus).</b> For each hour: how many aircraft will land
        (our stand-in for the arrival acceptance rate), with an 80% range, against the schedule.
        {" "}<b className="text-[var(--act)]">{act}</b> hours to act on · <b className="text-[var(--watch)]">{watch}</b> to watch. Click an hour for the reasons.
      </p>
      <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
        <div className="grid grid-cols-[4rem_minmax(0,1fr)_4.5rem] gap-3 border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">
          <span>Hour</span>
          <span><span className="text-[var(--ink)]">│</span> scheduled · <span className="text-[var(--accent)]">▬</span> forecast 80% range · ● actual · numbers: forecast of scheduled (range)</span>
          <span>Status</span>
        </div>
        {rows.length === 0 && <p className="px-3 py-4 text-[var(--muted)]">No forecast for this day.</p>}
        {rows.map((r) => <HourLine key={r.key} r={r} max={max} threshold={threshold} />)}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">{label}{children}</label>;
}

function StatusChip({ s }: { s: HourRow["status"] }) {
  if (s === "normal") return <span className="text-xs text-[var(--muted)]">Normal</span>;
  return (
    <span className={`w-fit rounded px-1.5 py-0.5 text-xs font-medium ${s === "act" ? "bg-[var(--act-bg)] text-[var(--act)]" : "bg-[var(--watch-bg)] text-[var(--watch)]"}`}>
      {s === "act" ? "Act" : "Watch"}
    </span>
  );
}

function HourLine({ r, max, threshold }: { r: HourRow; max: number; threshold: number | null }) {
  const a = r.aar;
  const x = (v: number) => Math.min(100, (v / max) * 100);
  return (
    <details className="border-b border-[var(--line)] last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[4rem_minmax(0,1fr)_4.5rem] items-center gap-3 px-3 py-2 hover:bg-[var(--hover)]">
        <span className="font-mono tabular-nums">{r.hour}</span>
        {a ? (
          <span className="flex items-center gap-3">
            <span className="relative h-3.5 flex-1" aria-hidden>
              <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--line)]" />
              <span className={`absolute inset-y-0.5 rounded-sm ${r.status === "act" ? "bg-[var(--act-bg)] ring-1 ring-[var(--act)]" : "bg-[var(--accent-bg)] ring-1 ring-[var(--accent)]"}`}
                style={{ left: `${x(a.interval_low)}%`, width: `${Math.max(0.5, x(a.interval_high) - x(a.interval_low))}%` }} />
              <span className="absolute inset-y-0 w-0.5 bg-[var(--ink)]" style={{ left: `${x(a.scheduled_arrivals)}%` }} />
              {a.actual_arrivals != null && (
                <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink)]" style={{ left: `${x(a.actual_arrivals)}%` }} />
              )}
            </span>
            <span className="w-36 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
              <b className="text-[var(--ink)]">{a.predicted_arrivals.toFixed(0)}</b> of {a.scheduled_arrivals} sched ({a.interval_low.toFixed(0)}–{a.interval_high.toFixed(0)})
            </span>
          </span>
        ) : <span className="text-xs text-[var(--muted)]">no forecast</span>}
        <StatusChip s={r.status} />
      </summary>
      <div className="grid gap-5 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-3 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold">Why: arrival model{a ? `, forecast ${a.predicted_arrivals.toFixed(0)} (range ${a.interval_low.toFixed(0)}–${a.interval_high.toFixed(0)})` : ""}</h3>
          {a ? (
            <>
              <Factors factors={a.top_factors} unit="arrivals" />
              <p className="mt-1 text-xs text-[var(--muted)]">Issued {fmt(a.issue_utc)} · historical average {a.baseline_arrivals?.toFixed(0) ?? "–"} · actual {a.actual_arrivals ?? "–"}</p>
            </>
          ) : <p className="text-xs text-[var(--muted)]">No forecast for this hour.</p>}
          {r.recs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {r.recs.map((x, i) => <li key={i} className="text-xs"><span className="font-medium">{x.rule}:</span> {x.evidence.join(" · ")}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold">Delay model: sampled flights this hour</h3>
          {r.flights.length === 0 ? <p className="text-xs text-[var(--muted)]">None in the sample.</p> : (
            <ul className="space-y-1">
              {r.flights.slice(0, 6).map((f) => (
                <li key={`${f.flight_id}-${f.horizon_h}`} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-mono">{f.sched_local.slice(11, 16)}</span>
                  <span className="font-medium">{f.carrier}{f.flight_number}</span>
                  <span className="text-[var(--muted)]">{f.origin}→{f.dest}</span>
                  {threshold != null && <RiskBar risk={f.risk} threshold={threshold} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

// unit "arrivals": effect in arrivals per hour (fewer is worse). unit "pp": effect on delay risk in percentage points (more is worse).
function Factors({ factors, unit }: { factors: Factor[]; unit: "arrivals" | "pp" }) {
  return (
    <ul className="space-y-0.5">
      {factors.map((f) => {
        const v = (f.shap ?? 0) * (unit === "pp" ? 100 : 1);
        const bad = unit === "pp" ? v > 0 : v < 0;
        return (
          <li key={f.feature} className="text-xs">
            <span className={`inline-block w-16 tabular-nums ${bad ? "text-[var(--act)]" : "text-[var(--good)]"}`}>{v > 0 ? "+" : ""}{v.toFixed(1)}{unit === "pp" ? " pp" : ""}</span>
            {f.label} = {String(f.value ?? "–")}
            {f.observed_utc && <span className="text-[var(--muted)]"> · observed {fmt(f.observed_utc)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function RiskBar({ risk, threshold }: { risk: number; threshold: number }) {
  const s = (x: number) => `${Math.min(100, (x / 0.5) * 100)}%`;
  return (
    <span className="inline-flex items-center gap-1.5" title={`risk ${pct(risk, 1)}; alert line ${pct(threshold, 1)}`}>
      <span className="relative inline-block h-1.5 w-16 rounded-sm bg-[var(--track)]">
        <span className={`absolute inset-y-0 left-0 rounded-sm ${risk >= threshold ? "bg-[var(--act)]" : "bg-[var(--muted)]"}`} style={{ width: s(risk) }} />
        <span className="absolute -inset-y-0.5 w-px bg-[var(--ink)]" style={{ left: s(threshold) }} />
      </span>
      <span className="tabular-nums">{pct(risk)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ 3 · Historical trends */

async function Trends({ rates }: { rates: { month: RateRow[]; hour: RateRow[] } | null }) {
  const trends = await delayTrends();
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        History of the provided data, as <b className="text-[var(--ink)]">rates</b> (share of flights), never raw delay minutes, so busy and quiet
        airports compare fairly. Descriptive only: these are not model inputs.
      </p>
      {!trends ? <Missing what="delay_trends.json" /> : (
        <div className="grid gap-6 md:grid-cols-3">
          <TrendBlock trends={trends} by="month" title="Share of flights > 45 min late, by month" />
          <TrendBlock trends={trends} by="local_hour" title="…by scheduled local hour" />
          <TrendBlock trends={trends} by="weather_group" title="…by weather in the scheduled hour" />
        </div>
      )}
      {rates && (
        <div className="max-w-md">
          <h3 className="mb-1 text-xs font-semibold">Arrivals landed as a share of scheduled, by month (BTS, all flights)</h3>
          <Bars rows={rates.month.map((r) => ({ label: `${r.key} ${r.airport}`, rate: r.rate }))} max={1} />
        </div>
      )}
    </div>
  );
}

function TrendBlock({ trends, by, title }: { trends: DelayTrends; by: "month" | "local_hour" | "weather_group"; title: string }) {
  const agg = new Map<string, { s: number; n: number }>();
  for (const c of trends.severe_rate[by]) {
    const key = by === "weather_group" ? String(c[by]) : String(c[by]).padStart(2, "0");
    const k = `${key} ${c.airport}`;
    const v = agg.get(k) ?? { s: 0, n: 0 };
    v.s += c.rate * c.n;
    v.n += c.n;
    agg.set(k, v);
  }
  const rows = [...agg.entries()].filter(([, v]) => v.n >= 30).sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({ label, rate: v.s / v.n, n: v.n }));
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold">{title}</h3>
      <Bars rows={rows} max={Math.max(...rows.map((r) => r.rate), 0.01)} />
      <p className="mt-1 text-[11px] text-[var(--muted)]">Groups with fewer than 30 flights hidden.</p>
    </div>
  );
}

function Bars({ rows, max }: { rows: { label: string; rate: number; n?: number }[]; max: number }) {
  return (
    <ul className="space-y-px text-[11px] tabular-nums">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2" title={r.n != null ? `${r.n} flights` : undefined}>
          <span className="w-28 shrink-0 truncate text-[var(--muted)]">{r.label}</span>
          <span className="h-2 rounded-sm bg-[var(--accent)]" style={{ width: `${(r.rate / max) * 7}rem` }} />
          <span>{pct(r.rate, 1)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ 4 · Model evidence */

async function Evidence({ cases }: { cases: FailureCase[] }) {
  const [m, dm] = await Promise.all([aarMetrics(), delayMetrics()]);
  const inUse = m?.models.find((x) => x.name === m.selected_model);
  return (
    <div className="space-y-8">
      <p className="text-xs text-[var(--muted)]">
        Both models were trained on 2023, tuned on Jan–Jun 2024 and scored once on the unseen test year (Jul 2024 – Jul 2025), against simple historical baselines.
      </p>
      <Impact />

      <section>
        <h2 className="mb-1 text-base font-semibold">Delay model: severe-delay alerts (over 45 min), main target</h2>
        {!dm ? <Missing what="delay_metrics.json" /> : <DelayEvidence m={dm} />}
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Arrival model: arrivals per hour (AAR bonus)</h2>
        {!m ? <Missing what="aar_metrics.json" /> : (
          <>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Error (RMSE) in arrivals per hour on {m.test_rows.toLocaleString()} test forecasts. Lower is better.
            </p>
            <Table head={["Model", "All", "ATL", "DFW", "3 h ahead", "12 h ahead"]}
              rows={[m.baseline, ...m.models].map((x) => [
                x.name === m.selected_model ? `${x.name} (in use)` : x.name,
                num(x.test_rmse.all), num(x.test_rmse.ATL), num(x.test_rmse.DFW),
                num(avg(x.test_rmse["ATL h3"], x.test_rmse["DFW h3"])), num(avg(x.test_rmse["ATL h12"], x.test_rmse["DFW h12"])),
              ])} highlight={(r) => r[0].includes("in use")} />
            {inUse && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                The model in use has {(100 * (1 - inUse.test_rmse.all / m.baseline.test_rmse.all)).toFixed(0)}% lower error than the historical-average baseline.
                SARIMAX scores lower still because it uses arrivals counted up to the issue time, but it gives no weather evidence.
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Where it fails</h2>
        <p className="mb-2 text-xs text-[var(--muted)]">Known misses on the test year, why they happen, and how the coordinator would notice. Open a day from the &ldquo;Known failure days&rdquo; links on tabs 1–2.</p>
        <div className="grid gap-3 md:grid-cols-2">{cases.map((f, i) => <Failure key={i} f={f} />)}</div>
      </section>

      <details className="text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">Recommendation rules (D36)</summary>
        <ul className="mt-1 space-y-0.5">{RULE_TEXT.map((t) => <li key={t}>{t}</li>)}</ul>
      </details>
    </div>
  );
}

const avg = (a?: number, b?: number) => (a == null || b == null ? undefined : (a + b) / 2);
const num = (v?: number) => (v == null ? "–" : v.toFixed(2));

function DelayEvidence({ m }: { m: DelayMetrics }) {
  const sel = m.models.find((x) => x.name === m.selected_model);
  const row = (name: string, s: DelayScores) => [name, s.pr_auc.toFixed(3), pct(s.precision), pct(s.recall), s.f1.toFixed(3), pct(s.accuracy),
    `${s.confusion_matrix.tp} / ${s.confusion_matrix.fp} / ${s.confusion_matrix.fn}`];
  return (
    <>
      <p className="mb-2 text-xs text-[var(--muted)]">
        About 1 in 9 flights is severely delayed, so precision and recall matter more than accuracy. Alert line {pct(m.threshold, 1)} ({m.threshold_rule}).
      </p>
      <Table head={["Model", "PR-AUC", "Precision", "Recall", "F1", "Accuracy", "Caught / false alarms / missed"]}
        rows={[row("baseline", m.baseline), ...m.models.map((x) => row(x.name === m.selected_model ? `${x.name} (in use)` : x.name, x)),
          ...Object.entries(sel?.by_airport_direction ?? {}).map(([k, v]) => row(`   in use · ${k}`, v))]}
        highlight={(r) => r[0].includes("(in use)")} />
      <p className="mt-2 text-xs text-[var(--muted)]">
        Chosen on validation PR-AUC, not on the test year: LightGBM and XGBoost score slightly higher on test, and we report that rather than switch.
      </p>
    </>
  );
}

function Table({ head, rows, highlight }: { head: string[]; rows: string[][]; highlight?: (r: string[]) => boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--panel)]">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="text-left text-[var(--muted)]"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-[var(--line)] ${highlight?.(r) ? "font-semibold" : ""}`}>
              {r.map((c, j) => <td key={j} className="whitespace-pre px-3 py-1.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Failure({ f }: { f: FailureCase }) {
  return (
    <details className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
      <summary className="cursor-pointer"><span className="font-medium">{f.airport} {f.time_utc.slice(0, 16).replace("T", " ")}</span> · {f.what_happened}</summary>
      <p className="mt-2 text-xs"><b>Why:</b> {f.reason}</p>
      <p className="mt-1 text-xs"><b>How the coordinator knows:</b> {f.how_user_knows}</p>
    </details>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="rounded-md border border-dashed border-[var(--line)] p-3 text-[var(--muted)]">Not available: data/outputs/{what} has not been exported.</p>;
}

function Assumptions() {
  // Mirrors PLAN.md "Assumptions to state in the demo".
  const items = [
    "Severe delay exactly as the brief: DEP_DELAY > 45 (departures) / ARR_DELAY > 45 (arrivals); cancelled and diverted flights have no delay value.",
    "Runway headings ATL 80°, DFW 180° (brief); other airports: most common runway direction (OurAirports).",
    "Arrival rate = realised wheels-on arrivals per hour (BTS), not the FAA declared rate; cancelled and diverted flights are not arrivals.",
    "Inputs: the published schedule plus weather observations at least h hours old; no weather forecasts.",
    "Flights in the repeated autumn daylight-saving hour are dropped.",
    "Test period Jul 2024 – Jul 2025; models trained on 2023 only.",
  ];
  return (
    <footer className="mt-10 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
      <p className="mb-1 font-medium text-[var(--ink)]">Assumptions</p>
      <ul className="grid gap-x-8 gap-y-0.5 md:grid-cols-2">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="mt-2">Sources: challenge flight and hourly weather files · BTS On-Time Reporting (US DOT) · Meteostat hourly observations (NOAA ISD), stations 72219 ATL, 72259 DFW · OurAirports.</p>
    </footer>
  );
}

/* ------------------------------------------------------------------ runway wind (brief: crosswind / tailwind, not raw speed) */

type WindHour = { hour: string; dir: number; speed: number; head: number; cross: number; tail: number; heading: number; utc: string };
const WEATHER_CSV = path.join(process.cwd(), "data", "raw", "challenge5_hourly_weather_ATL_DFW.csv");
let windPromise: Promise<Map<string, WindHour[]> | null> | undefined;

// The provided hourly weather already holds the runway components for the brief's headings (ATL 80°, DFW 180°).
function windIndex() {
  windPromise ??= readFile(WEATHER_CSV, "utf8").then((text) => {
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const col = Object.fromEntries(head.split(",").map((c, i) => [c, i]));
    const idx = new Map<string, WindHour[]>();
    for (const line of lines) {
      const c = line.split(",");
      const local = c[col.time_local];
      const key = `${c[col.airport]}|${local.slice(0, 10)}`;
      const row: WindHour = {
        hour: local.slice(11, 13), dir: Number(c[col.wind_dir_deg]), speed: Number(c[col.wind_speed_kmh]),
        head: Number(c[col.headwind_kmh]), cross: Number(c[col.crosswind_kmh]), tail: Number(c[col.tailwind_kmh]),
        heading: Number(c[col.runway_heading_deg]), utc: c[col.time_utc],
      };
      const list = idx.get(key);
      if (list) list.push(row); else idx.set(key, [row]);
    }
    return idx;
  }).catch(() => null);
  return windPromise;
}

async function RunwayWind({ airport, date }: { airport: string; date: string }) {
  const idx = await windIndex();
  const hours = idx?.get(`${airport}|${date}`) ?? [];
  if (hours.length === 0) return null;
  const heading = hours[0].heading;
  const max = Math.max(10, ...hours.map((h) => Math.max(h.cross, h.tail, Math.max(0, h.head))));
  const cell = (v: number, tone: string) => (
    <td className="px-0.5 py-0.5 text-center">
      <span className={`block rounded-sm py-0.5 tabular-nums ${v > 0 ? tone : "text-[var(--muted)]"}`}
        style={v > 0 ? { opacity: 0.35 + 0.65 * Math.min(1, v / max) } : undefined}>{v > 0 ? v.toFixed(0) : "·"}</span>
    </td>
  );
  return (
    <section aria-labelledby="wind" className="mb-5 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
      <h2 id="wind" className="text-xs font-semibold">
        Runway wind at {airport}, {date} (runway heading {heading}° per the brief) · km/h, hourly observations
      </h2>
      <p className="mb-2 text-[11px] text-[var(--muted)]">
        Both models use crosswind and tailwind on the runway, not raw wind speed. A forecast made <i>h</i> hours ahead only sees
        readings at least <i>h</i> hours before each flight or hour.
      </p>
      <table className="w-full min-w-[42rem] border-collapse text-[11px]">
        <thead><tr><th className="w-24" />{hours.map((h) => <th key={h.utc} className="px-0.5 font-normal text-[var(--muted)]">{h.hour}</th>)}</tr></thead>
        <tbody>
          <tr><th className="pr-2 text-left font-normal text-[var(--muted)]">Crosswind</th>{hours.map((h) => <Fragment key={h.utc}>{cell(h.cross, "bg-[var(--watch-bg)] text-[var(--watch)]")}</Fragment>)}</tr>
          <tr><th className="pr-2 text-left font-normal text-[var(--muted)]">Tailwind</th>{hours.map((h) => <Fragment key={h.utc}>{cell(h.tail, "bg-[var(--act-bg)] text-[var(--act)]")}</Fragment>)}</tr>
          <tr><th className="pr-2 text-left font-normal text-[var(--muted)]">Headwind</th>{hours.map((h) => <Fragment key={h.utc}>{cell(Math.max(0, h.head), "bg-[var(--accent-bg)] text-[var(--accent)]")}</Fragment>)}</tr>
          <tr><th className="pr-2 text-left font-normal text-[var(--muted)]">Wind from</th>{hours.map((h) => <td key={h.utc} className="px-0.5 text-center tabular-nums text-[var(--muted)]">{h.speed > 0 ? `${h.dir}°` : "calm"}</td>)}</tr>
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------------------------------------------ impact (rubric: before/after vs baseline, measured vs estimated) */

async function Impact() {
  const [m, dm] = await Promise.all([aarMetrics(), delayMetrics()]);
  const sel = dm?.models.find((x) => x.name === dm.selected_model);
  const aar = m?.models.find((x) => x.name === m.selected_model);
  const fewerFalse = sel && dm ? 1 - sel.confusion_matrix.fp / dm.baseline.confusion_matrix.fp : null;
  const moreCaught = sel && dm ? sel.confusion_matrix.tp / dm.baseline.confusion_matrix.tp - 1 : null;
  const lessError = aar && m ? 1 - aar.test_rmse.all / m.baseline.test_rmse.all : null;
  return (
    <section aria-labelledby="impact" className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 id="impact" className="mb-1 text-base font-semibold">Impact vs today&apos;s reference</h2>
      <p className="mb-3 text-xs text-[var(--muted)]">
        <b className="text-[var(--ink)]">Measured</b> on the test year (Jul 2024 – Jul 2025) against the historical baselines, which stand in for
        planning from typical rates. Effects on full traffic volumes are <b className="text-[var(--ink)]">estimates</b>, not measured: the flight file is a ~1% sample.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Delay alerts: fewer false alarms" value={fewerFalse == null ? "–" : pct(fewerFalse)} />
        <Stat label="Delay alerts: more severe flights caught" value={moreCaught == null ? "–" : `+${pct(moreCaught)}`} />
        <Stat label="Arrivals per hour: lower forecast error" value={lessError == null ? "–" : pct(lessError)} />
      </div>
      <h3 className="mb-1 text-xs font-semibold">Adoption constraints</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--muted)]">
        <li>Needs live schedule and weather feeds; this demo replays past data.</li>
        <li>Trained on one year of a ~1% flight sample: retrain on full flight data before operational use.</li>
        <li>Sees local weather and the schedule only: network knock-on delays, IT outages and ground stops are invisible (see Where it fails).</li>
        <li>Runway headings are the brief&apos;s fixed assumption; real use needs the airport&apos;s active runway configuration.</li>
        <li>The alert line balances precision and recall (max F1); a unit may prefer fewer false alarms or more catches and should set its own.</li>
        <li>Advisory only: it supports the coordinator&apos;s existing rate and delay-program decisions, it does not make them.</li>
      </ul>
    </section>
  );
}
