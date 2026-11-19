---
version: 1
slug: "src-client-dashboard-tsx"
primary_target: "src/client/Dashboard.tsx"
related_targets: ["src/dashboard.ts","src/client/dashboard.css","src/client/CareCharts.tsx"]
---

# Dashboard

Use the existing Babylog palette, system fonts, and labeled activity colors.

## Layout

Show date controls and totals first.
Then show Daily rhythm, Left vs right, When activities start, and Continuous timeline.
Support hover, touch, and keyboard inspection. Keep exact record details available.
Check phone scrolling, text alternatives, and chart state after refreshes.

## Breast balance

Show daily Left and Right durations, totals, and percentages.
Daily breast times expands a table with date headers and text values.
Split Both equally. Exclude recorded feeding breaks.
Exclude unknown sides and durations. Running records include elapsed time only.
Show this section for All activities and Feeding filters.

See docs/design.md and docs/architecture.md for range, time, and aggregation rules.
