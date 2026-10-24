# Surge

Surge is an agentic 3D circuit design studio. Describe a circuit in plain language, inspect the generated topology in a spatial workspace, edit components, control routing layers, and run a fast electrical sanity check.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Architecture

- `src/agent` interprets circuit intent and produces structured designs.
- `src/engine` evaluates circuit state and surfaces electrical warnings.
- `src/components/CircuitScene.tsx` renders the interactive Three.js workspace.
- `src/data` defines the component library and starter topology.
- `src/types` is the shared circuit contract between every layer.

## Current capabilities

- 3D orbitable workspace with eight component families
- Power, signal, and ground routing layers
- Prompt-driven circuit generation for sensor, timing, motor, solar, and audio circuits
- Editable component references and values
- Live DC metrics, design-rule warnings, and animated simulation state
- Local project state and responsive editor shell

## Team

- [Enes Yilmaz](https://github.com/EnesYilmazcode)
- [Colin Lee](https://github.com/ColinL-code)

## Status

Setup only. Nothing runs yet.
