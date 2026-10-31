# 3-minute pitch (draft)

Times are targets. Numbers marked *AAR* come from `data/outputs/aar_metrics.json` once YXY4NG's run is in.

## 0:00–0:30 · The user and the problem (problem realism)
- Our user is the **Traffic Management Coordinator** at Atlanta or Dallas Fort Worth: the person who sets the airport's arrival rate and asks for ground delay programs.
- Today they cut rates **when the weather arrives**. By then aircraft are already airborne or pushing back, so they hold in the air or sit on taxiways burning fuel, and cancellations ripple through the day (challenge brief).
- They need to know **3 to 12 hours earlier**, flight by flight and hour by hour.

## 0:30–1:15 · What we built (technical soundness), live demo
- For every ATL/DFW departure and arrival, a **risk score** that it will be more than 45 minutes late, at 3, 6, 9 and 12 hours ahead. *Demo: risk board.*
- For every hour, a forecast of **arrivals per hour** (AAR), with a range. *Demo: AAR view.*
- Every score shows **why**: the top factors, with the time each weather reading was taken, including crosswind and tailwind on the runway. *Demo: evidence panel.*
- Machine learning makes the predictions; **Claude only writes the shift briefing** from those outputs and says so when data is missing. Rule-based recommendations; **the TMC decides**. *Demo: briefing.*
- Works with only weather known at forecast time (never newer than the horizon), and the pipeline takes any airport code.

## 1:15–2:00 · Does it work? (honest evaluation)
- Tested once on a full unseen year, Jul 2024 – Jul 2025, against the TMC's simplest reference: the usual delay rate for that hour and month.
- Delay risk: **PR-AUC 0.235 vs 0.157**, precision 24% vs 17%, **32% fewer false alarms** while catching 6% more severe flights.
- Useful even 12 hours out (PR-AUC 0.229 vs 0.157).
- Weather is what makes the difference: adding it to the schedule raises PR-AUC by 16–18% for every algorithm we tried.
- AAR: *RMSE model vs baseline (AAR)*.

## 2:00–2:30 · Where it fails, and how the TMC knows (trust & traceability)
- 28 December 2024, Atlanta: 7 severe delays, none flagged. The cause was knock-on delays from the network (late aircraft, air traffic system), with no severe weather at ATL.
- The TMC sees it: low risk **and** no severe weather in the evidence panel, so the score is not the whole story. Fix: inbound-aircraft and network inputs.

## 2:30–3:00 · Impact and limits
- Measured on the test year: fewer false alarms means fewer wasted rate cuts and programs for the same or better catch rate. Effects at full traffic volume are an estimate.
- Limits we state: weather observations only (no forecasts), a 1% flight sample, one training year, the brief's fixed runway headings.
- Next: forecast data and inbound-aircraft delays.
