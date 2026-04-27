# Trip Monitor — Density Pass

User feedback: "bisa ga area kanban nya di gedein? tapi cardnya agak dikecilin lagi.
jadi biar di fullscreen itu bisa muat lebih banyak kanban. sama di trip monitor drawer
nya juga lu benerin lagi, lu kecilin aja area yang ga terlalu penting dan gedein area
yang lebih penting"

## Kanban changes

- `.trip-monitor-kanban` margin-top 6px → 4px, gap 14px → 10px
- `.trip-monitor-kanban-column-header` padding 10px 14px → 7px 12px
- `.trip-monitor-kanban-column-body` padding 10px → 8px, gap 8px → 6px,
  max-height calc(100vh − 360px) → calc(100vh − 260px)
- `.trip-monitor-kanban .trip-monitor-card` padding 10px 12px 10px 14px → 7px 10px
  7px 12px, gap 6px → 4px, border-radius 10px → 8px
- Card font-sizes: title 14px → 12.5px, status 13px → 11.5px,
  subline/location/temp/note 11px → 10.5px

Result on fullscreen: ~4 cards visible per column above the fold (vs 3 before),
zero text overflow.

## Drawer rebalance

- KPI grid `.trip-monitor-detail-summary`:
  - minmax(180px, 1fr) → minmax(140px, 1fr) → 6 tiles fit on 1-2 rows instead of 3
  - gap 10px → 6px
  - mini-metric padding 10px 12px → 6px 10px
  - mini-metric strong 14px → 13px
  - mini-metric span (label) 10px + uppercase tracking
- Drawer width min(720px, 92vw) → min(840px, 94vw) — drawer itself digedein
- Hide low-value sections in non-fullscreen mode:
  - `.trip-monitor-detail-history` (full historical raw rows table) hidden — only
    shown when "Open as page" toggled
  - All panel-card descriptive `<p>` prose hidden in drawer (header titles only)
- Compact panel-card headers in drawer: padding-top 12px, padding-bottom 8px,
  h3 13px
- Stops timeline + map + chart get more vertical space:
  - `.trip-monitor-detail-panel` min-height 320px
  - `.trip-monitor-detail-graphic-panel` min-height 360px
  - In drawer (non-fullscreen), panels stacked 1 column instead of 2 (each gets
    full drawer width)
- Settings stack gap 12px (tighter)

## Result

- Drawer: KPI tiles → metric strip → stops timeline (5-step horizontal) → map
  → chart, all visible with less scrolling.
- Historical raw data table only appears when user clicks "Open as page" (Maximize2)
  — this matches the principle that fullscreen mode is for deep work.
