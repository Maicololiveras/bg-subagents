# BG vs FG — Interactive Presentation

Visual documentation for `@maicolextic/bg-subagents-opencode`, used as an artifact in the upstream PR to `Gentleman-Programming/gentle-ai`. Explains the BG/FG interaction model, three-level control cascade, step-by-step flow example, and v1.0 vs v1.1 visual strategy.

## Files

| File | Purpose |
|------|---------|
| `bg-vs-fg-interactive.jsx` | React component source — edit this to customize content |
| `bg-vs-fg-interactive.html` | Self-contained runnable — double-click to open in any browser |

## How to view

Open `bg-vs-fg-interactive.html` in any modern browser (Chrome, Firefox, Safari, Edge). No build step, no npm install, no server required. Navigate slides with the arrow buttons or keyboard arrow keys.

## How to customize

1. Edit `bg-vs-fg-interactive.jsx` — all content lives in `deck`, `flowSteps`, `cascade`, `v10Cards`, and the `css` template literal at the bottom.
2. Copy the updated component code into the `<script type="text/babel">` block inside the `.html` file, applying the two modifications:
   - Line 1: change the import to `const { useEffect, useMemo, useState } = React;`
   - Remove `export default` from the main function declaration.
3. To use the component in a React project, import the `.jsx` file directly — no modifications needed.

## Technical note

The HTML file uses Babel Standalone + React 18 UMD via `unpkg.com` CDN. An internet connection is required on first load; the browser caches the CDN scripts afterwards.

## Credits

Design by Michael Jiménez (WebColombia). Presentation component created 2026-04-24 as part of the Plan D pivot for v1.0 of `@maicolextic/bg-subagents-opencode`.
