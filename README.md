# Surge

Surge is a 3D breadboard design studio with a Gemini-powered circuit assistant. Place components from the left library, inspect the board in the center, and chat with Surge on the right.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

For AI chat, copy `.env.example` to `.env.local`, set `GEMINI_API_KEY`, and restart the server. The default model is `gemini-2.5-flash`; `GEMINI_MODEL` can override it. Credentials remain on the local server and are never embedded in the browser bundle. Keep `.env.local` out of Git.

The local API runs inside the Vite development and preview servers. A static `dist` deployment by itself does not include the API.

## Architecture

- `server/surge-api.ts` sends circuit context and chat history to Gemini.
- `src/agent` validates incremental edit proposals before they reach the board.
- `src/engine` evaluates circuit state and surfaces electrical warnings.
- `src/components/CircuitScene.tsx` renders the interactive Three.js workspace.
- `src/data` defines the component library and starter topology.
- `src/components/BreadboardModel.tsx` builds the socket board without downloaded assets.
- `src/types` is the shared circuit contract between every layer.

## Current capabilities

- 3D orbitable breadboard with eight component families
- Numbered columns, terminal strips, separate power rails, and socket-snapped placement
- Power, signal, and ground routing layers
- Surge chat with Gemini, conversation history, cancellation, and circuit context
- Incremental proposals to add, update, or remove parts and wires, with an Apply changes control
- Editable component references and values
- Estimated component metrics, rule warnings, and animated simulation state
- Local project state and responsive editor shell
- Light editor panels and 3D workspace
- Portable circuit files with validated import and export

Use the folder icon to open a circuit file and the download icon to export the current design as `.surge.json`. Save stores the circuit in this browser. Opening a file loads it into the workspace; Save persists the imported design. Invalid files leave the current workspace intact.

The board currently uses component-level connections. Socket groups are defined, but pins are not yet assigned to sockets and the estimate engine is not a SPICE solver. Breadboard geometry and placement do not imply pin-level electrical verification.

Gemini requires a valid key and available quota or prepaid credit. Authentication, quota, billing, and malformed-response failures are shown in chat without replacing your circuit. Editing the board cancels an in-flight request and discards outdated proposals.

Run `npm test` to check circuit files, socket grouping and placement, incremental actions, and local API error handling (Node.js 22.6 or newer). Run `npm run build` to check both client and server TypeScript and build the frontend.

## Team

- [Enes Yilmaz](https://github.com/EnesYilmazcode)
- [Colin Lee](https://github.com/ColinL-code)

## Status

Setup only. Nothing runs yet.
