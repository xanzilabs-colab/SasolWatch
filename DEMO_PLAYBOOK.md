# SasolSniff live demo playbook

The goal: prove the sensor reacts to **real** things in the air, then show the system turning that reaction into direction, source estimate, pollutants, alert and report.

## What your sensor can and can't show

An MQ-type gas sensor responds to many gases and smoke at once (alcohol, butane, smoke, and others depending on the model). It says "something changed", not "this is chemical X". So say:

> "The sensor detects that the air changed and how fast. Our fusion engine combines that with wind, humidity, temperature, local weather and what lies upwind to estimate the type and direction of the source. The real product adds calibrated particle and gas sensors to identify specific pollutants."

Never say the prototype "identifies" a chemical or "proves" a company caused it.

## Safety (read first)

- Get the organisers' OK for any spray, smoke or lighter. Some venues ban flames and smoke, and smoke detectors may trigger.
- **Never spray directly onto the board or sensor.** Spray into the air a little upwind of the fan.
- **Never combine spray and flame.** Aerosols and lighter gas are flammable.
- Lighter gas: if you use it, release the gas **unlit**, for **one second**, at arm's length, away from people and every flame, with the room ventilated. A lit lighter in front of a fan just blows the flame sideways and gives little signal. If you light it anyway, keep it at least a metre from the sensor and the electronics, on a non-flammable surface, never in front of the fan intake.
- Keep the fan on a stable surface, cables out of its path, and a bottle of water nearby.

## Before the demo (do this 15 minutes earlier)

1. Power the node and let the gas sensor warm up for **at least 3 minutes**. In the firmware set `WARMUP_MS` to `180000`.
2. Make sure the air around the sensor is clean and still. Fan off. Press the button **briefly** to set the clean-air baseline. The LED flashes 3 times.
3. Open the dashboard with `?demo=1`. Check the status says LIVE and the Sensor response is near zero.
4. Label the wind pot dial with compass points. Turn it to choose where the wind comes **from**: North 0, East 90, South 180, West 270.
5. Place the fan 50 to 100 cm from the sensor, pointing at it, with the stimulus **upwind of the fan** (behind it or beside it) so the fan carries it across.
6. Rehearse each stimulus once and write down the numbers in the dashboard's rehearsal table: peak rise, seconds to peak, seconds to recover. Gas sensors take 30 to 120 seconds to clear, so leave gaps and keep the fan running to clear the air between steps.

## The demo, step by step (about 4 minutes)

Your classifier's answer depends on the **wind dial setting**, the **speed of the rise**, and the time of day, so you can show different results on purpose:

| Step | What you do | What the sensor does | Wind dial | What the dashboard should estimate |
|---|---|---|---|---|
| 1. Calm | Nothing. Show baseline and normal pollutant levels | Flat | Any | "No surge. Monitoring." |
| 2. No false alarm | Fan only, no stimulus | Should barely move (airflow alone is not a pollutant) | Any | Still no surge. This builds trust |
| 3. Sudden release | One short puff of alcohol-based sanitiser spray into the air upwind of the fan | Fast, sharp rise | About 330 (NNW) | Surge. Sudden onset with the illustrative industrial site upwind: **possible industrial plume** (tested on the engine) |
| 4. Smouldering smoke | Incense stick or a just-blown-out match, upwind of the fan. Keep it slow and gentle | Slower, gradual rise | About 140 (SE) | Gradual onset with the illustrative residential area upwind: **household burning**, strongest in the evening or when it is cold |
| 5. Same release, different wind | Repeat a sudden release (spray or one unlit, one-second lighter gas release at arm's length), but with the dial at about 140 (SE) | Sharp rise | About 140 | Sudden onset with **no industrial site upwind**: the estimate moves to **open burning or waste**. This is the best proof that wind and surroundings change the answer |
| 6. Backup trigger | Long-press the button (2 s) | Adds a labelled test surge ramp | Any | Marked **TEST** everywhere |
| 7. Live wind change | During a surge, turn the wind dial 90 degrees | Same | Rotate | The cone swings and the candidate list changes |
| 8. Alerts | Point to the alert feed (and show your phone if live WhatsApp is on) | | | "Early warning to schools and homes" |
| 9. Report | Click Report on the event | | | Printable evidence report for the municipality |
| 10. Weather | Open the weather panel | | | Real local wind vs your demo vane: "in production this comes from sensors and weather data" |

Notes:
- The source result is a **rule-based estimate**. I tested the engine on sample sequences: a sudden rise with wind from the industrial side gives industrial plume; a sudden rise from the residential side gives open burning; a slow rise from the residential side gives household burning; a slow rise from the road side gives traffic. It comes from rise speed, wind direction, what lies upwind (illustrative positions), time of day, temperature, humidity and rain. Changing the wind dial is how you show the logic reacting. Be open that the positions are illustrative.
- If a step doesn't produce a clear response, move on. Don't wait.
- If the sensor misbehaves entirely, switch to **Simulator mode** (clearly labelled) and say so out loud, or use the test-surge button, which is also labelled.

## What to say at each moment

- Step 2: "Airflow alone does nothing. It only reacts when something is actually in the air."
- Step 3: "That's a real change in the air from this sensor. Now watch what the system does with it: direction from the wind, candidate sources upwind, a source estimate with a confidence, and simulated pollutant levels derived from the sensor rise."
- Step 7: "Change the wind and the estimate changes. That's why one sensor gives a direction, and several give a location."
- Close: "Prototype today, one proxy sensor. Production, calibrated particle and gas sensors, several nodes, verified facility data. Same engine."

## If the judges ask

- **Is it accurate?** "Low-cost sensors aren't regulatory grade. We use them to flag when and roughly where to investigate, and one node would be calibrated against an official station."
- **Are the pollutant values real?** "They're simulated from the real sensor rise, with the profile of the estimated source type. The production sensors measure each pollutant directly."
- **Are those real factories?** "No. The source positions are illustrative placeholders. We'd load verified licensed-facility data."
- **Are you accusing Sasol?** "No. We estimate source types and upwind areas to help the municipality prioritise inspections. Residents, municipality and industry all get the same data."
