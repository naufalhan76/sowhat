# Decisions — Trip Monitor Revamp

## [2026-04-30T07:08] Initial Decisions

### Execution Strategy
- Plan = design spec, needs conversion to executable tasks
- Start with Phase 1A (modal restructure) — lowest risk, immediate UX win
- Phase 1B (backend) blocks 1C/1D, must complete before UI override work
- Phase 2A-2C can be deferred (not blocking core override functionality)

### Open Items Requiring Resolution
1. **HAR response for driver phone** — Phase 2C blocker, defer
2. **OSRM self-hosted vs public** — Phase 2B decision, defer (start with public)
3. **Map picker component** — Phase 1C, decide during implementation (try Leaflet first)
4. **Drag-drop library** — Phase 1C, use native HTML5 DnD (plan recommends it for <10 items)
5. **JSONB query optimization** — Phase 1B, start with JSONB containment, benchmark if slow
6. **Force-close incident resolution** — Phase 1B, auto-resolve immediately (simpler UX)
7. **Override badge on kanban card** — Phase 1A, YES (plan shows cyan dot on card)

### Implementation Order (Revised)
```
Phase 1A: Modal restructure (5 sections, header merge, deep dive nav)
Phase 1B: Backend foundation (DB tables, API endpoints, pipeline injection)
Phase 1C: Override UI (temp range, stops, force close, badge)
Phase 1D: Deep dive pages (historical, incidents, audit log)
[Phase 2A-2C deferred until Phase 1 complete]
```
