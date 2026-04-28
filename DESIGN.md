# Design

Visual system for Sowhat Ops Dashboard. Notion-inspired product UI with emerald accent.

## Visual Theme

Notion-style flat surfaces. No gradients, no glassmorphism, no decorative shadows. Hierarchy through typography weight and spatial grouping. Dark mode primary, light mode supported.

**Scene sentence:** Fleet dispatcher scanning 15 truck statuses on a 24-inch monitor in a warehouse office at 7am, fluorescent overhead lighting, coffee in hand, needs to spot the one truck with a temperature alert in under 2 seconds.

**Color strategy:** Restrained. Tinted neutrals with emerald accent under 10%. Severity colors (danger, warning, success) used functionally, never decoratively.

## Colors

### Dark theme (default)

| Role | Value | Usage |
|------|-------|-------|
| Background | `#191919` | Page background |
| Surface | `#191919` | Cards, panels |
| Surface raised | `#202225` | Elevated elements, sidebar |
| Surface hover | `rgba(255,255,255,0.055)` | Hover states |
| Border | `rgba(255,255,255,0.094)` | Default borders |
| Border strong | `rgba(255,255,255,0.16)` | Hover/focus borders |
| Text main | `#E6E6E6` | Body text |
| Text dark | `#ECECEC` | Headings |
| Text secondary | `#B5B5B5` | Supporting text |
| Text muted | `#8C8C8C` | Labels, captions |
| Primary | `#10B981` | Brand accent, active states |
| Primary text | `#6EE7B7` | Primary on dark bg |
| Danger text | `#FB7185` | Error, temp alerts |
| Warning text | `#FBBF24` | Caution states |
| Success text | `#34D399` | Healthy, moving |
| Sidebar bg | `#202020` | Navigation background |

### Light theme

| Role | Value | Usage |
|------|-------|-------|
| Background | `#FFFFFF` | Page background |
| Surface | `#FFFFFF` | Cards, panels |
| Surface raised | `#F7F6F3` | Elevated, sidebar |
| Border | `#EBEBEA` | Default borders |
| Text main | `#37352F` | Body text |
| Text dark | `#1F1E1B` | Headings |
| Text muted | `#787773` | Labels |
| Primary | `#059669` | Brand accent |
| Danger text | `#B91C1C` | Errors |

## Typography

| Role | Font | Size | Weight | Tracking |
|------|------|------|--------|----------|
| Page title | Inter | 24px | 700 | -0.02em |
| Section heading | Inter | 16px | 600 | -0.015em |
| Card heading | Inter | 15px | 600 | -0.01em |
| Body | Inter | 13px | 400 | 0 |
| Label / caption | Inter | 12.5px | 400 | 0 |
| Small / note | Inter | 11.5px | 400 | 0 |
| Stat value | Inter | 22px | 600 | -0.015em |
| Monospace | JetBrains Mono | 12px | 400 | 0 |

Font features: `cv02`, `cv03`, `cv04`, `cv11` (alternate glyphs for a, g, l, y).

**Rules:**
- No uppercase text-transform on labels. Sentence case only.
- No letter-spacing on labels. Zero tracking.
- Tabular numbers (`font-feature-settings: 'tnum'`) on all numeric displays.

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| Workspace padding | 28px | Main content area |
| Card padding | 14-20px | Panel content |
| Card header padding | 16px 20px | Panel headers |
| Gap (sections) | 20px | Between major sections |
| Gap (cards) | 10-12px | Between cards in grids |
| Gap (inline) | 8px | Between inline elements |

## Elevation

No box-shadows on cards. Hierarchy through border + background difference only.

| Level | Treatment |
|-------|-----------|
| Flat | `border: 1px solid var(--border)` |
| Hover | `border-color: var(--border-strong)` + `background: var(--surface-hover)` |
| Modal | `box-shadow: var(--shadow-lg)` + scrim backdrop |

## Radius

| Element | Radius |
|---------|--------|
| Cards / panels | 8px |
| Stat cards | 6px |
| Inputs / buttons | 5-6px |
| Small elements (pills, chips) | 4px |

## Components

### NavRail (sidebar)
- 240px expanded, 56px collapsed
- Sticky, full viewport height
- Notion-style items: 13.5px Inter, 6px 8px padding, 4px radius
- Active: `var(--surface-active)` background, `var(--text-dark)` text
- Off-canvas drawer below 960px

### CommandBar (topbar)
- 56px height, sticky
- Title left, tools right (search, date range, action buttons)
- All interactive items normalized to 32px height
- Hides search + date range below 600px

### Surface (card primitive)
- `var(--surface)` background, 1px border, 8px radius
- No box-shadow
- Hover: border-color transition 120ms

### Action (button primitive)
- sm: 28px, md: 32px, lg: 40px
- Primary: emerald bg, white text
- Secondary: transparent, border
- Ghost: transparent, no border

### Stat cards
- 6px radius, 14px 16px padding
- Label: 12.5px/400 muted
- Value: 22px/600 dark, tnum
- Hover: border-color + bg transition 120ms

## Motion

- All transitions: 120ms ease
- No translateY/scale on hover (causes layout shift)
- `prefers-reduced-motion: reduce` kills all animation/transition
- Easing: ease (CSS default), no bounce/elastic

## Interaction

- `cursor: pointer` on all clickable elements
- `focus-visible`: 2px solid primary, 2px offset
- Form focus: border-strong + 3px primary-glow ring

## Responsive breakpoints

| Breakpoint | Layout change |
|------------|---------------|
| 960px | NavRail becomes drawer; command bar compacts; KPI grid 2-col |
| 880px | Fleet workspace stacks to 1-col |
| 600px | Search/date hidden; KPI 1-col; fleet master-detail toggle |

## Anti-patterns (banned)

- No uppercase letter-spacing on labels
- No monospace fonts for stat values (use Inter with tnum)
- No translateY/scale hover on cards
- No decorative box-shadows on cards
- No glassmorphism
- No gradient text
- No side-stripe borders (border-left accent)
- No hero-metric template (big number + small label + gradient)
