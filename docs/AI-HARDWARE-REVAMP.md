# Surge: AI that builds and codes on the whole parts kit

Status as of 2026-10-24. Plan, infrastructure needs, and what already runs.

## Summary

The chat used to refuse a 7-segment display because its prompt listed five parts. It now runs on the local Claude Code CLI, knows the 7-segment display, and places it, wires it, and simulates it. In the browser, Surge built a circuit where the ESP32 counts 1 to 9 on the display in a loop, and the simulator lights the right segments at each step.

What is still missing: a repair loop that feeds simulator errors back to the model, a hosted (Vercel) path that runs the same model, and the rest of the parts kit beyond the display.

## What runs now (measured)

| Check | Result |
|---|---|
| Local chat turn, LED circuit (Claude Opus, via `claude -p`) | 6 s, valid proposal, passes server validation |
| Counter request (ESP32 + display + 7 resistors + wiring + sketch) | 15 s, 17 actions, applied and run in the browser |
| Segment current with 330 ohm, 3.3 V GPIO, 2.0 V forward drop | 3.94 mA per lit segment (readout shows 3.94 mA) |
| Digits 0 to 9 on the worked layout | Each digit lights exactly its segments (analysis test) |
| Counting sketch through the sketch runtime | Shows 1 to 9 in order, 800 ms each (test) |
| Test suite | 87 pass (73 before, +7 CLI adapter, +7 display) |
| Typecheck | Clean |
| Chat cost, Opus | First turn in a session writes about 49k cached tokens: $0.39 measured. Next turns read the cache: $0.011 measured, plus the proposal's output tokens (not measured per turn) |

## Infrastructure requirements

Local development (what Enes runs today):

- Node 22.6 or newer (22.14 here) and `npm install`.
- Claude Code CLI signed in on this machine (2.1.310 here). The chat calls `claude -p` with `--tools ""`, so the model can answer but cannot read files or run commands. No API key is needed.
- The dev server on `127.0.0.1:5173`. Background servers get reaped under memory pressure, so run `start-local.bat` in a terminal you own.
- Chrome, for the end-to-end tests.

Hosted (Vercel project `surge-api`, the public editor on Firebase):

- Still Gemini. The Gemini quota cap is unchanged, and the hosted route has not been redeployed.
- The Claude Code CLI cannot run on Vercel: there is no login and no `claude` binary. The hosted route needs the Anthropic API, called from the function with a key stored as an encrypted Vercel environment variable. That key needs a spend cap in the Anthropic console.
- The function's time limit must cover a proposal. A 15 s turn fits, and the 180 s budget set for the CLI path would need a plan that allows it.
- Deploy order when this is ready: `git pull --rebase` (Colin pushes too), then `vercel deploy --prod --yes` for the API, then `npx firebase deploy --only hosting` for the editor. Both halves must ship together, or the hosted editor will show actions its code cannot run.

## How the agent works (framework)

1. **Propose.** Claude returns JSON matching a schema (`--json-schema`), with a reply and up to 50 actions.
2. **Validate.** `validateWorkbenchActions` in `server/workbench-api.ts` rejects unknown tools, bad holes and bad references before anything reaches the browser.
3. **Apply on a model of the board.** `public/editor/board-model.js` applies the actions to plain data and reports errors such as taken holes or a display off row e.
4. **Simulate.** The solver in `public/editor/simulation.js` runs the netlist. Each ESP32 pin a sketch drives is an ideal 3.3 V or 0 V source, and each display segment is an LED from its pin to the common cathode. The sketch runtime (`src/sketch-runtime.ts`) runs the Arduino C++ on a virtual clock.
5. **Preview and apply.** The person accepts or declines. Nothing changes the board until they press Apply.

Missing from the loop: step 4's results do not go back to the model. The model writes one attempt and never sees the simulator's verdict. Sparky already has this pattern in `backend/verify.js`, where AI builds are checked in the simulator with a repair loop, and 12 of 12 live builds passed on the first try. That is the next thing to port.

## Adding a part (checklist)

Every part needs the same seven pieces, which is why the 7-segment display took one change to each file:

1. A 3D model with its holes and a footprint in `parts-more.js` or `parts.js`.
2. A board-model action (`place_<part>`) that marks every hole it uses.
3. A server validator entry and a schema entry in `workbench-api.ts`.
4. A prompt entry that says what the part is and how to wire it.
5. A netlist case in `simulation.js` that turns it into solver elements.
6. A readout line in `analyze()` that says what happened, including errors.
7. A test in `tests/` that checks the holes, the validator, and the simulated result.

## Phased plan

**Phase 0, done today.** Local Claude backend. 7-segment display placed, wired, simulated, and driven by the ESP32. Counter demo runs.

**Phase 1, next.**
- Repair loop: after simulation, if a segment is over its rating or a digit is wrong, send the readout back and ask for one correction. Cap at two attempts.
- A `wire_seg7` macro, so the model names the display and the ESP32 pins and the layout is generated. Today the model places 18 actions by hand, which is where errors come from.
- Verification card for displays. `localVerify` in `chat.js` still counts only LEDs and buzzers, so a display-only board shows no card.
- Hosted path on the Anthropic API, behind a spend cap.

**Phase 2, inputs.** Let the sketch read buttons. `espInputs` already maps GPIO inputs to wired levels. The test is "press to count up".

**Phase 3, code quality.** Use the sketch runtime's line errors as the repair signal, and add serial output to the readout.

**Phase 4, more parts.** Put back the capacitor, potentiometer, servo, ultrasonic, transistor, and fan. They were removed from the palette in the 19:37 commit. Each one follows the checklist above.

**Phase 5, evaluation.** A fixed task list scored by the simulator and sketch runner: count 1 to 9, blink, a two-digit counter, a button-driven counter, two displays, an LED chase. Track first-try pass rate and attempts per task, and compare models on the same list. This is the number that answers the benchmark question.

## Limits to keep in mind

- The solver is DC at each sketch step. It has no analog timing, no pin resistance on the GPIO, and no arbitrary ICs. Without a series resistor, a segment is reported as a short circuit, which is correct for an ideal source.
- `delay()` does not wait. The sketch's virtual clock is replayed in real time, so a long loop repeats after its run length.
- The 3D display is small at the default camera distance. Zoom in to see the segments clearly.
- The 3D model's segment lighting uses emissive intensity from the solver's current. Lit segments glow in proportion to their current.

## Open items

- The "modal" problem Enes mentioned is not reproduced. The Clear confirmation shows correctly now. Once, Clear emptied the board without the confirmation; that did not repeat.
- Nothing is committed or pushed. The changes are in the working tree of `Surge` on `main`.
- The hosted Vercel route and the Firebase editor are not redeployed.

## Files changed

- `server/claude-cli.ts` (new): runs `claude -p` with the schema and no tools.
- `server/workbench-api.ts`: provider switch, the `place_seg7` action in the validator, schema, and prompt.
- `server/surge-api.ts`: provider options and status.
- `vite.config.ts`: local chat defaults to Claude; `SURGE_PROVIDER=gemini` switches back.
- `public/editor/simulation.js`: display netlist, segment readout, visual hook.
- `public/editor/board-model.js`: `place_seg7` and its occupancy.
- `public/editor/chat.js`: executes and previews `place_seg7` through the editor's own footprint check.
- `public/editor/parts-more.js`: per-segment materials and `setSegments`.
- `tests/claude-cli.test.mjs`, `tests/seg7-display.test.mjs`, `tests/helpers/fake-claude.mjs` (new).
- `.env.example`, `README.md`, `start-local.bat` (new), this report.
