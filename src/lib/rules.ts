import type { AarHour, DelayFlight } from "./data";

// D26: recommendations are fixed rules on model outputs; each shows the rule that fired and its inputs.
// D36: these rules and thresholds are a PROPOSAL (Claude draft per D37) until a team member approves them.
export const RULES_STATUS = "Proposed (D36), pending team approval";

export type Recommendation = {
  rule: string;
  title: string;
  action: string;
  evidence: string[];
  severity: "high" | "medium" | "info";
};

const SHORTFALL_RATIO = 0.85; // R1: forecast below 85% of scheduled arrivals
const SHORTFALL_MIN = 5; // ...and at least 5 arrivals short
const ALERT_CLUSTER = 3; // R3: 3+ flagged flights in one hour
const WIDE_RANGE_RATIO = 0.6; // R4: 80% range wider than 60% of the forecast

const WEATHER_FACTORS = ["win_any_severe_wx", "win_any_thunder", "win_max_precip", "win_any_rain"];

export function aarRules(h: AarHour): Recommendation[] {
  const out: Recommendation[] = [];
  const short = h.scheduled_arrivals - h.predicted_arrivals;
  const hour = h.time_local.slice(11, 16);
  if (h.scheduled_arrivals > 0 && h.predicted_arrivals < SHORTFALL_RATIO * h.scheduled_arrivals && short >= SHORTFALL_MIN) {
    out.push({
      rule: "R1 capacity shortfall",
      title: `${h.airport} ${hour} local: forecast ${h.predicted_arrivals.toFixed(0)} arrivals vs ${h.scheduled_arrivals} scheduled`,
      action: "Review the arrival rate for this hour; consider arrival metering or a ground delay program if the shortfall holds at shorter horizons.",
      evidence: [
        `Forecast ${h.predicted_arrivals.toFixed(1)} (80% range ${h.interval_low.toFixed(0)}–${h.interval_high.toFixed(0)}), issued ${h.issue_utc} (${h.horizon_h} h ahead)`,
        `Rule: forecast < ${SHORTFALL_RATIO * 100}% of scheduled and ≥ ${SHORTFALL_MIN} short`,
      ],
      severity: h.interval_high < h.scheduled_arrivals ? "high" : "medium",
    });
  }
  const wx = h.top_factors.filter((f) => WEATHER_FACTORS.includes(f.feature) && (f.shap ?? 0) < 0);
  if (wx.length > 0) {
    out.push({
      rule: "R2 weather pulling the forecast down",
      title: `${h.airport} ${hour} local: observed weather lowers the forecast`,
      action: "Brief the weather signal to the shift and watch the next observations before acting.",
      evidence: wx.map((f) => `${f.label} = ${f.value} (observed ${f.observed_utc ?? "n/a"}), effect ${f.shap?.toFixed(1)} arrivals`),
      severity: "medium",
    });
  }
  if (h.predicted_arrivals > 0 && h.interval_high - h.interval_low > WIDE_RANGE_RATIO * h.predicted_arrivals) {
    out.push({
      rule: "R4 low confidence",
      title: `${h.airport} ${hour} local: wide forecast range`,
      action: "Treat this hour as uncertain; confirm with the live traffic picture before acting.",
      evidence: [`80% range ${h.interval_low.toFixed(0)}–${h.interval_high.toFixed(0)} around ${h.predicted_arrivals.toFixed(0)}`],
      severity: "info",
    });
  }
  return out;
}

export function delayRules(flights: DelayFlight[]): Recommendation[] {
  const byHour = new Map<string, DelayFlight[]>();
  for (const f of flights.filter((x) => x.alert)) {
    const key = `${f.airport} ${f.sched_local.slice(0, 13)}`;
    byHour.set(key, [...(byHour.get(key) ?? []), f]);
  }
  return [...byHour.entries()]
    .filter(([, fs]) => fs.length >= ALERT_CLUSTER)
    .map(([key, fs]) => ({
      rule: "R3 delay alert cluster",
      title: `${key}:00 local: ${fs.length} flights flagged for a severe delay`,
      action: "Notify the affected airlines and the Command Center of elevated delay risk for this hour.",
      evidence: fs.slice(0, 5).map((f) => `${f.carrier}${f.flight_number} ${f.origin}→${f.dest}: risk ${(f.risk * 100).toFixed(0)}%`),
      severity: "high" as const,
    }));
}

export const RULE_TEXT = [
  `R1 capacity shortfall: forecast arrivals < ${SHORTFALL_RATIO * 100}% of scheduled and at least ${SHORTFALL_MIN} short → review the arrival rate (high if the whole 80% range is below schedule).`,
  "R2 weather: a weather window feature is among the top factors and lowers the forecast → brief the signal with its observation time.",
  `R3 delay cluster: ${ALERT_CLUSTER}+ flights in one local hour above the delay alert threshold (D21) → notify airlines / Command Center.`,
  `R4 low confidence: 80% range wider than ${WIDE_RANGE_RATIO * 100}% of the forecast → confirm with the live traffic picture.`,
];
