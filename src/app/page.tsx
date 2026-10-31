import Link from "next/link";
import {
  aarIndex, aarMetrics, delayFailureCases, delayIndex, delayMetrics, delayTrends, HORIZONS,
  type AarHour, type DelayFlight, type DelayMetrics, type DelayScores, type DelayTrends, type FailureCase, type Factor,
  type RateRow,
} from "@/lib/data";
import { aarRules, delayRules, RULE_TEXT, type Recommendation } from "@/lib/rules";
import Briefing from "./briefing";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;
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
  const [index, di, metrics] = await Promise.all([aarIndex(), delayIndex(), aarMetrics()]);
  const airports = index?.airports ?? ["ATL", "DFW"];
  const view = one(sp.view) === "evidence" ? "evidence" : "outlook";
  const airport = airports.includes(one(sp.airport) ?? "") ? one(sp.airport)! : airports[0];
  const horizon = (HORIZONS as readonly number[]).includes(Number(one(sp.h))) ? Number(one(sp.h)) : 3;
  const dates = index?.dates.get(airport) ?? [];
  const notable = [...new Set((metrics?.failure_cases ?? []).filter((f) => f.airport === airport).map((f) => f.time_utc.slice(0, 10)))];
  const date = dates.includes(one(sp.date) ?? "") ? one(sp.date)! : (notable[0] ?? dates[0] ?? "");
  const href = (v: string) => "/?" + new URLSearchParams({ view: v, airport, date, h: String(horizon) });

  return (
    <div className="min-h-full bg-[var(--surface)]">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Arrival Capacity &amp; Delay Outlook</h1>
            <p className="text-xs text-[var(--muted)]">Traffic Management Unit · advisory forecast 3–12 h ahead · the coordinator decides</p>
          </div>
          <nav className="flex rounded-md border border-[var(--line)] p-0.5 text-sm" aria-label="Views">
            {([["outlook", "Shift outlook"], ["evidence", "Model evidence"]] as const).map(([v, label]) => (
              <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined}
                className={`press rounded px-3 py-1 ${view === v ? "bg-[var(--ink)] text-[var(--panel)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5 text-sm">
        {view === "outlook" ? (
          <Outlook airport={airport} airports={airports} date={date} dates={dates} horizon={horizon} notable={notable}
            hours={index?.day.get(`${airport}|${horizon}|${date}`) ?? []}
            flights={di?.day.get(`${airport}|${horizon}|${date}`) ?? []} threshold={di?.threshold ?? null} hasIndex={!!index} />
        ) : (
          <Evidence rates={index?.rates ?? null} />
        )}
        <Assumptions />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ Shift outlook */

function Outlook(props: {
  airport: string; airports: string[]; date: string; dates: string[]; horizon: number; notable: string[];
  hours: AarHour[]; flights: DelayFlight[]; threshold: number | null; hasIndex: boolean;
}) {
  const { airport, airports, date, dates, horizon, notable, hours, flights, threshold } = props;
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
  const act = rows.filter((r) => r.status === "act").length;
  const watch = rows.filter((r) => r.status === "watch").length;
  const alerts = flights.filter((f) => f.alert).length;
  const actions = rows.flatMap((r) => r.recs.filter((x) => x.severity !== "info").map((x) => ({ ...x, hour: r.hour })));
  const max = Math.max(1, ...hours.map((h) => Math.max(h.scheduled_arrivals, h.interval_high, h.actual_arrivals ?? 0)));

  return (
    <>
      <form action="/" className="mb-5 flex flex-wrap items-end gap-x-5 gap-y-3">
        <input type="hidden" name="view" value="outlook" />
        <Field label="Airport">
          <select name="airport" defaultValue={airport} className="control">{airports.map((a) => <option key={a}>{a}</option>)}</select>
        </Field>
        <Field label="Day (local)">
          <input type="date" name="date" defaultValue={date} min={dates[0]} max={dates.at(-1)} className="control" />
        </Field>
        <Field label="Forecast issued">
          <select name="h" defaultValue={horizon} className="control">{HORIZONS.map((h) => <option key={h} value={h}>{h} h ahead</option>)}</select>
        </Field>
        <button className="press control bg-[var(--ink)] text-[var(--panel)]">Update</button>
        {notable.length > 0 && (
          <p className="text-xs text-[var(--muted)]">
            Review cases:{" "}
            {notable.map((d) => <Link key={d} href={`/?view=outlook&airport=${airport}&date=${d}&h=${horizon}`} className="mr-2 underline underline-offset-2">{d}</Link>)}
          </p>
        )}
      </form>

      {!props.hasIndex ? <Missing what="aar_forecast.json" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="timeline">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="timeline" className="text-base font-semibold">{airport} · {date} · issued {horizon} h ahead</h2>
              <p className="text-[var(--muted)]">
                <b className="text-[var(--act)]">{act}</b> hours to act on · <b className="text-[var(--watch)]">{watch}</b> to watch ·{" "}
                <b className="text-[var(--ink)]">{alerts}</b> of {flights.length} sampled flights above the delay alert line
              </p>
            </div>
            <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
              <div className="grid grid-cols-[4rem_minmax(0,1fr)_6.5rem_4.5rem] gap-3 border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">
                <span>Hour</span>
                <span>Arrivals: <span className="text-[var(--ink)]">│</span> scheduled · <span className="text-[var(--accent)]">▬</span> forecast 80% range · ● actual</span>
                <span>Flights at risk</span><span>Status</span>
              </div>
              {rows.length === 0 && <p className="px-3 py-4 text-[var(--muted)]">No forecast for this day.</p>}
              {rows.map((r) => <HourLine key={r.key} r={r} max={max} threshold={threshold} />)}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Flights at risk: sampled flights whose chance of a delay over 45 min is at or above the alert line
              {threshold != null ? ` (${pct(threshold, 1)})` : ""}. Select an hour to see the evidence.
            </p>
          </section>

          <aside className="space-y-6">
            <section aria-labelledby="actions">
              <h2 id="actions" className="mb-2 text-base font-semibold">Recommended actions</h2>
              {actions.length === 0 ? (
                <p className="text-[var(--muted)]">No rule fired for this day. Keep the planned rates.</p>
              ) : (
                <ol className="space-y-2">
                  {actions.map((a, i) => (
                    <li key={i} className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
                      <p className="mb-1 flex items-center gap-2 text-xs"><StatusChip s={a.severity === "high" ? "act" : "watch"} /><span className="font-mono">{a.hour}</span></p>
                      <p>{a.action}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">Rule {a.rule}</p>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-xs text-[var(--muted)]">Fixed rules on the model outputs (D36). Advisory only.</p>
            </section>
            <Briefing key={`${airport}-${date}-${horizon}`} airport={airport} date={date} horizon={horizon} />
          </aside>
        </div>
      )}
    </>
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
  const x = (v: number) => (Math.min(100, (v / max) * 100));
  const alerts = r.flights.filter((f) => f.alert).length;
  return (
    <details className="border-b border-[var(--line)] last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[4rem_minmax(0,1fr)_6.5rem_4.5rem] items-center gap-3 px-3 py-2 hover:bg-[var(--hover)]">
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
            <span className="w-32 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
              <b className="text-[var(--ink)]">{a.predicted_arrivals.toFixed(0)}</b> of {a.scheduled_arrivals} sched · {a.interval_low.toFixed(0)}–{a.interval_high.toFixed(0)}
            </span>
          </span>
        ) : <span className="text-xs text-[var(--muted)]">no forecast</span>}
        <span className="text-xs tabular-nums">
          {r.flights.length === 0 ? <span className="text-[var(--muted)]">–</span> : <><b className={alerts ? "text-[var(--act)]" : ""}>{alerts}</b> of {r.flights.length}</>}
        </span>
        <StatusChip s={r.status} />
      </summary>
      <div className="grid gap-5 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-3 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold">Arrival forecast{a ? `: ${a.predicted_arrivals.toFixed(0)} (range ${a.interval_low.toFixed(0)}–${a.interval_high.toFixed(0)})` : ""}</h3>
          {a ? (
            <>
              <Factors factors={a.top_factors} unit="arrivals" />
              <p className="mt-1 text-xs text-[var(--muted)]">Issued {fmt(a.issue_utc)} · historical baseline {a.baseline_arrivals?.toFixed(0) ?? "–"} · actual {a.actual_arrivals ?? "–"}</p>
            </>
          ) : <p className="text-xs text-[var(--muted)]">No forecast for this hour.</p>}
          {r.recs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {r.recs.map((x, i) => <li key={i} className="text-xs"><span className="font-medium">{x.rule}:</span> {x.evidence.join(" · ")}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold">Sampled flights this hour</h3>
          {r.flights.length === 0 ? <p className="text-xs text-[var(--muted)]">None in the sample.</p> : (
            <ul className="space-y-2">
              {r.flights.slice(0, 6).map((f) => (
                <li key={`${f.flight_id}-${f.horizon_h}`} className="text-xs">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono">{f.sched_local.slice(11, 16)}</span>
                    <span className="font-medium">{f.carrier}{f.flight_number}</span>
                    <span className="text-[var(--muted)]">{f.origin}→{f.dest}</span>
                    {threshold != null && <RiskBar risk={f.risk} threshold={threshold} />}
                    <span className="text-[var(--muted)]">typical {pct(f.baseline_rate)} · actual {f.actual_severe == null ? "–" : f.actual_severe ? "> 45 min" : "≤ 45 min"}</span>
                  </p>
                  <Factors factors={f.top_factors ?? []} unit="pp" />
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
            <span className={`inline-block w-14 tabular-nums ${bad ? "text-[var(--act)]" : "text-[var(--good)]"}`}>{v > 0 ? "+" : ""}{v.toFixed(1)}{unit === "pp" ? " pp" : ""}</span>
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

/* ------------------------------------------------------------------ Model evidence */

async function Evidence({ rates }: { rates: { month: RateRow[]; hour: RateRow[] } | null }) {
  const [m, dm, trends, dfc] = await Promise.all([aarMetrics(), delayMetrics(), delayTrends(), delayFailureCases()]);
  const inUse = m?.models.find((x) => x.name === m.selected_model);
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-base font-semibold">Arrival forecast accuracy</h2>
        {!m ? <Missing what="aar_metrics.json" /> : (
          <>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Error (RMSE) in arrivals per hour on the test period {m.split.test.join(" – ")}, {m.test_rows.toLocaleString()} forecasts. Lower is better.
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
        <h2 className="mb-1 text-base font-semibold">Severe-delay alerts (over 45 min)</h2>
        {!dm ? <Missing what="delay_metrics.json" /> : <DelayEvidence m={dm} />}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">History, as rates</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {trends ? <TrendBlock trends={trends} /> : <Missing what="delay_trends.json" />}
          {rates && (
            <div>
              <h3 className="mb-1 text-xs font-semibold">Arrivals landed as a share of scheduled, by month</h3>
              <Bars rows={rates.month.map((r) => ({ label: `${r.key} ${r.airport}`, rate: r.rate }))} max={1} />
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Where it fails</h2>
        <p className="mb-2 text-xs text-[var(--muted)]">Largest misses on the test period, why they happen, and how the coordinator would notice.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {[...(m?.failure_cases.slice(0, 2) ?? []), ...((dfc ?? dm?.failure_cases) ?? [])].map((f, i) => <Failure key={i} f={f} />)}
        </div>
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
  const row = (name: string, s: DelayScores) => [name, s.pr_auc.toFixed(3), pct(s.precision), pct(s.recall), s.f1.toFixed(3),
    `${s.confusion_matrix.tp} / ${s.confusion_matrix.fp} / ${s.confusion_matrix.fn}`];
  return (
    <>
      <p className="mb-2 text-xs text-[var(--muted)]">
        About 1 in 9 flights is severely delayed, so precision and recall matter more than accuracy. Alert line {pct(m.threshold, 1)} ({m.threshold_rule}).
      </p>
      <Table head={["Model", "PR-AUC", "Precision", "Recall", "F1", "Caught / false alarms / missed"]}
        rows={[row("baseline", m.baseline), ...(sel ? [row(`${sel.name} (in use)`, sel)] : []),
          ...Object.entries(sel?.by_airport_direction ?? {}).map(([k, v]) => row(`   ${k}`, v))]}
        highlight={(r) => r[0].includes("in use")} />
    </>
  );
}

function TrendBlock({ trends }: { trends: DelayTrends }) {
  const byMonth = new Map<string, { s: number; n: number }>();
  for (const c of trends.severe_rate.month) {
    const k = `${String(c.month).padStart(2, "0")} ${c.airport}`;
    const v = byMonth.get(k) ?? { s: 0, n: 0 };
    v.s += c.rate * c.n;
    v.n += c.n;
    byMonth.set(k, v);
  }
  const rows = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, rate: v.s / v.n }));
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold">Share of flights more than 45 min late, by month</h3>
      <Bars rows={rows} max={Math.max(...rows.map((r) => r.rate), 0.01)} />
    </div>
  );
}

function Bars({ rows, max }: { rows: { label: string; rate: number }[]; max: number }) {
  return (
    <ul className="space-y-px text-[11px] tabular-nums">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[var(--muted)]">{r.label}</span>
          <span className="h-2 rounded-sm bg-[var(--accent)]" style={{ width: `${(r.rate / max) * 9}rem` }} />
          <span>{pct(r.rate, 1)}</span>
        </li>
      ))}
    </ul>
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
    "Runway headings ATL 80°, DFW 180° (brief); other airports: most common runway direction (OurAirports).",
    "Arrival rate = realised wheels-on arrivals per hour (BTS), not the FAA declared rate; cancelled and diverted flights are not arrivals.",
    "Inputs: the published schedule plus weather observations at least 3 h old; no weather forecasts.",
    "Flights in the repeated autumn daylight-saving hour are dropped.",
    "Test period Jul 2024 – Jul 2025; models trained on 2023 only.",
  ];
  return (
    <footer className="mt-10 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
      <p className="mb-1 font-medium text-[var(--ink)]">Assumptions</p>
      <ul className="grid gap-x-8 gap-y-0.5 md:grid-cols-2">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="mt-2">Sources: BTS On-Time Reporting (US DOT) · Meteostat hourly observations (NOAA ISD), stations 72219 ATL, 72259 DFW · OurAirports.</p>
    </footer>
  );
}
