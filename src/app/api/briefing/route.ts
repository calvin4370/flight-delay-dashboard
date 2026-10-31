import { aarIndex, delayIndex } from "@/lib/data";
import { aarRules, delayRules } from "@/lib/rules";

// D14: Claude writes a TMC shift briefing from model outputs only. It never invents numbers and says when data is missing.
const MODEL = "claude-sonnet-5-5";
const SYSTEM = `You write a short shift briefing for an FAA Traffic Management Coordinator (TMC) at a US hub airport.
Rules you must follow:
- Use ONLY the facts in the JSON you are given. Do not add numbers, causes, airlines, weather or events that are not in it.
- Every number you state must appear in the JSON. Quote observation timestamps (UTC) when you mention a weather signal.
- If a section of the JSON is null or empty, say plainly that the data is not available. Do not guess.
- Recommendations: restate only the fired rules in "recommendations", naming the rule. The TMC makes the final decision.
- Mention uncertainty: give the 80% range for the hours you highlight.
- Format: 3 short sections with headings: "Capacity outlook", "Flights at risk", "Rules fired". Under 220 words.`;

export async function POST(request: Request) {
  const { airport, date, horizon } = (await request.json()) as { airport: string; date: string; horizon: number };
  const [index, di] = await Promise.all([aarIndex(), delayIndex()]);
  const hours = index?.day.get(`${airport}|${horizon}|${date}`) ?? [];
  const flights = di ? (di.day.get(`${airport}|${horizon}|${date}`) ?? []) : null;
  const facts = {
    airport, local_date: date, hours_ahead: horizon,
    arrival_forecast: hours.length === 0 ? null : hours.map((h) => ({
      local_hour: h.time_local.slice(11, 16), scheduled: h.scheduled_arrivals, forecast: h.predicted_arrivals,
      range_80: [h.interval_low, h.interval_high], issued_utc: h.issue_utc,
      top_factors: h.top_factors.map((f) => ({ factor: f.label, value: f.value, effect_arrivals: f.shap, observed_utc: f.observed_utc })),
    })),
    flights_at_risk: flights === null ? null : flights.filter((f) => f.alert).map((f) => ({
      flight: `${f.carrier}${f.flight_number}`, route: `${f.origin}-${f.dest}`, sched_local: f.sched_local, risk: f.risk,
      top_factors: (f.top_factors ?? []).map((x) => ({ factor: x.label, value: x.value, observed_utc: x.observed_utc })),
    })),
    recommendations: [...hours.flatMap(aarRules), ...delayRules(flights ?? [])].map((r) => ({ rule: r.rule, title: r.title, action: r.action })),
  };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ facts, briefing: null, error: "Briefing unavailable: ANTHROPIC_API_KEY is not set on the server. The facts below are what Claude would be given." });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700, system: SYSTEM,
      messages: [{ role: "user", content: `Facts (JSON):\n${JSON.stringify(facts)}` }],
    }),
  });
  if (!res.ok) {
    return Response.json({ facts, briefing: null, error: `Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}` });
  }
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  const briefing = body.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return Response.json({ facts, briefing, model: MODEL });
}
