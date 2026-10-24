# Surge

Surge is a local 3D breadboard designer with component placement, pin-to-pin wiring, a DC circuit solver, and a Gemini-powered assistant.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

For AI chat, copy `.env.example` to `.env.local`, set `GEMINI_API_KEY`, and restart the server. The default model is `gemini-2.5-flash`; `GEMINI_MODEL` can override it. Credentials stay on the local server and are excluded from Git and browser bundles.

## Editor

- Light editor shell, dark anti-static workbench, and right-side Surge chat
- Physically based molded plastic, reflective metal leads, clear LED lenses, studio reflections, and contact shadows
- Rendered component thumbnails, property inspector, resistor presets, and selectable LED colors
- Full-size 50-column breadboard with 700 sockets, row labels, rail markings, and a center channel
- Resistors, LEDs, 9 V batteries, active buzzers, and push buttons with detailed 3D models
- Socket-aware placement previews, rotation, selection, and deletion
- Curved jumper wires between sockets and component pins, with six wire colors
- Orbit, pan, zoom, reset view, and clear board controls
- Undo/redo history and smooth camera reset
- Modified nodal analysis with nonlinear LED models, battery internal resistance, and button switches
- Simulation results, LED illumination, buzzer audio, open-circuit and overcurrent reporting
- Local autosave, saved-project browser, file previews, and validated `.surge` downloads/imports
- Gemini chat with board context, conversation history, ghost edit previews, and Accept/Decline controls

Keyboard shortcuts: `S` select, `P` place, `W` wire, `R` rotate, `Delete` remove, and `Escape` cancel. Left-drag orbits; right-drag pans; the scroll wheel zooms.

Open lists browser-saved projects and offers file import. Download saves the current circuit and a thumbnail. Circuit files are validated before replacing the board.

The additional studio is available at `/studio.html`; its browser-saved designs remain separate.

## Architecture

- `src/workbench.ts` initializes the local renderer and loads editor modules in dependency order.
- `public/editor/scene.js`, `board.js`, and `parts.js` implement the workbench and geometry.
- `public/editor/board-model.js` resolves shared socket connectivity and prevents overlapping leads.
- `public/editor/inspector.js` edits component values; `thumbs.js` renders library thumbnails.
- `public/editor/input.js` and `editor.js` handle placement, wiring, keyboard controls, and persistence.
- `public/editor/solver.js` solves DC node voltages and nonlinear diode currents.
- `public/editor/simulation.js` converts breadboard connectivity into a netlist and drives visual/audio feedback.
- `public/editor/project-format.js` validates portable circuit data.
- `public/editor/chat.js` previews and applies assistant actions.
- `server/workbench-api.ts` calls Gemini and validates pin-aware action proposals.
- `server/surge-api.ts` supplies the local API, origin checks, and provider status.

The API runs in the Vite development and preview servers. A static `dist` deployment alone does not provide the Gemini backend.

## Verification and limits

Run `npm test` for analytic solver cases, breadboard connectivity, file validation, chat behavior, and API checks. Run `npm run build` for client/server type checks and the production build. Node.js 22.6 or newer is required for the test runner.

The solver models DC operating points for the supported components. It does not provide time-domain, thermal, RF, or arbitrary IC simulation. Buzzer audio is feedback driven by the simplified electrical model.

Gemini requires available quota or prepaid credits. Provider authentication, billing, and request failures appear in chat without changing the circuit. Assistant edits are previewed before acceptance; outdated proposals are discarded if the board changes.

## Team

- [Enes Yilmaz](https://github.com/EnesYilmazcode)
- [Colin Lee](https://github.com/ColinL-code)
