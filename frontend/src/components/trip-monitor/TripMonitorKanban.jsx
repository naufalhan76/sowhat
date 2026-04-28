import { KANBAN_COLUMNS } from './helpers.jsx';
import { TripMonitorUnitCard } from './TripMonitorUnitCard.jsx';

export function TripMonitorKanban({ rows = [], selectedRowId, onOpen }) {
  const grouped = KANBAN_COLUMNS.map((column) => ({
    ...column,
    rows: rows.filter((row) => column.match(String(row?.severity || '').trim())),
  }));

  return (
    <div className="trip-monitor-kanban">
      {grouped.map((column) => (
        <section key={column.key} className={`trip-monitor-kanban-column trip-monitor-kanban-column-${column.key}`}>
          <header className="trip-monitor-kanban-column-header">
            <span className="trip-monitor-kanban-column-title">
              <span className="trip-monitor-kanban-column-dot" />
              {column.label}
            </span>
            <span className="trip-monitor-kanban-column-count">{column.rows.length}</span>
          </header>
          <div className="trip-monitor-kanban-column-body">
            {column.rows.length ? column.rows.map((row) => (
              <TripMonitorUnitCard
                key={row.rowId}
                row={row}
                isActive={row.rowId === selectedRowId}
                onOpen={() => onOpen?.(row)}
              />
            )) : <div className="trip-monitor-kanban-column-empty">No trips in this severity bucket.</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

