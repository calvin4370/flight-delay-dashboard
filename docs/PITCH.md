# 3-minute pitch, presented from the dashboard

Open before starting: `http://localhost:3005/?view=delay&airport=ATL&date=2025-04-06&h=3`
**Bold** = what to click. About 1:30 each.

---

## Part 1 · Calvin (0:00–1:30): the problem and the delay model

**[Tab 1 · Delay risk, ATL, 6 Apr 2025, 3 h ahead]**

- Our user is the **Traffic Management Coordinator** at Atlanta or Dallas Fort Worth: the person who sets the arrival rate and calls delay programs.
- Today they react **when the weather arrives**. By then aircraft are already holding in the air or stuck on taxiways, burning fuel, and cancellations spread through the day.
- We warn them **3 to 12 hours earlier**, flight by flight.
- This is a replay of a real day from our test year. Every flight in or out of ATL gets a **risk of being more than 45 minutes late**, using only weather observed hours before.
- Top of the page: the model flagged 7 flights, and **7 of the 8 that were actually late were caught**, with no false alarms.
- Each flight shows **why**: the top factors and when each weather reading was taken. Point at a flagged row.
- **[Lead time → 12 h ahead, Show]** The same day, warned 12 hours out.

**[Tab 4 · Model evidence]**

- Tested once on a full unseen year against the historical rate: precision **24% vs 17%**, **32% fewer false alarms**, 6% more late flights caught.
- **[Known failure day 2024-12-28 on Tab 1]** Where it fails: 28 December, seven late flights, none flagged. The delays came from the network, not ATL's weather. The coordinator sees it: low risk and a steady headwind with no tailwind, so the score is not the whole story.

---

## Part 2 · Yuxuan (1:30–3:00): arrival capacity, actions and trust

**[Tab 2 · Arrival capacity, same day]**

- For each hour: how many aircraft will land, with an **80% range**, against the schedule, and what actually landed.
- **[Click an hour marked Act or Watch]** Why the forecast is low, with the time of each weather reading, and the rule that fired.
- **[Runway wind strip]** We use crosswind and tailwind on the runway heading, not raw wind speed.

**[Side panel]**

- **Recommended actions** come from fixed rules on the model outputs, for example "forecast below 85% of schedule: review the arrival rate". The rule is always shown.
- **[Shift briefing]** Claude writes the coordinator's briefing only from these outputs, and says so when data is missing. The models predict; Claude explains; **the coordinator decides**.

**[Tab 3 · Historical trends]**

- History as rates, not raw minutes, so busy and quiet airports compare fairly.

**[Tab 4 · Model evidence, Impact box]**

- Arrival forecast: **23% lower error** than the historical average. Measured on the test year; full-traffic effects are estimates.
- Limits we state: weather observations only, a 1% flight sample, one training year, the brief's fixed runway headings. The pipeline takes any airport code.
- Close: earlier, explained warnings, with the coordinator in control.
