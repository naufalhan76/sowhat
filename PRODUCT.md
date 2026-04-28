# Product

## Register

product

## Users

Fleet operations analysts and management supervisors at cold-chain logistics companies. Ops staff monitor refrigerated trucks in real-time during shifts, watching for temperature excursions, GPS anomalies, and delivery delays. Supervisors review daily rollups, warehouse KPIs, and incident trends to make staffing and routing decisions. Both groups work on desktop monitors in office or warehouse control rooms, occasionally checking status on tablets.

## Product Purpose

Internal ops dashboard that aggregates live telemetry from Solofleet GPS/temperature hardware into actionable views: fleet status, temperature incident tracking, trip monitoring with TMS integration, stop/idle analysis, and per-warehouse Astro KPI scoring. Replaces manual spreadsheet compilation with automated polling, alerting, and historical analysis. Success means fewer missed temperature excursions, faster incident response, and reliable daily reporting without manual data pulls.

## Brand Personality

Clean, minimal, focused. The interface should feel like a well-organized control room: everything in its place, nothing competing for attention, critical signals surfacing clearly above the noise. Confidence through restraint, not decoration.

## Anti-references

- Generic SaaS dashboard templates: purple gradients, hero-metric cards with big numbers and tiny labels, card soup with identical layouts repeated endlessly.
- Overly decorative monitoring tools: glassmorphism, neon glows, animated backgrounds that distract from the data.
- Enterprise legacy: cluttered toolbars with 40 buttons, tiny gray text, information overload without hierarchy.

## Design Principles

1. **Signal over chrome.** Every pixel serves comprehension. If a visual element doesn't help the operator understand fleet status faster, remove it.
2. **Calm urgency.** Normal state is quiet and low-contrast. Alerts escalate through color intensity and position, not animation or size. The interface stays calm until something genuinely needs attention.
3. **Density with clarity.** Operators need many data points visible simultaneously. Pack information tightly, but maintain clear hierarchy through typography weight and spatial grouping, not borders and boxes.
4. **One glance, one answer.** Each panel should answer a single question at a glance. Overview answers "is everything OK right now?" Fleet answers "where is each truck and what's its status?" Temp errors answers "what went wrong today?"
5. **Tool-grade reliability.** The interface should feel like infrastructure: always there, always correct, never surprising. Consistency in layout, interaction patterns, and visual language across every panel.

## Accessibility and Inclusion

- WCAG 2.1 AA minimum for all text contrast.
- Color is never the sole indicator of status; pair with icons or text labels.
- Respect `prefers-reduced-motion` for all transitions and animations.
- Keyboard navigation support for all interactive elements.
- Indonesian language UI with English technical terms where standard in the logistics industry.
