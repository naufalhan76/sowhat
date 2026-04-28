import { AlertTriangle, AlertCircle, ShieldCheck } from 'lucide-react';
import { KANBAN_COLUMNS } from './helpers.jsx';
import { TripMonitorUnitCard } from './TripMonitorUnitCard.jsx';

const COLUMN_META = {
  critical: {
    icon: AlertCircle,
    description: 'Butuh tindakan segera',
  },
  warning: {
    icon: AlertTriangle,
    description: 'Perlu perhatian',
  },
  normal: {
    icon: ShieldCheck,
    description: 'Berjalan normal',
  },
};

export function TripMonitorKanban({ rows = [], selectedRowId, onOpen, severityCounts }) {
  const grouped = KANBAN_COLUMNS.map((column) => ({
    ...column,
    rows: rows.filter((row) => column.match(String(row?.severity || '').trim())),
  }));

  return (
    <div className="tm-kanban">
      {grouped.map((column) => {
        const meta = COLUMN_META[column.key] || COLUMN_META.normal;
        const Icon = meta.icon;

        return (
          <section key={column.key} className={`tm-kanban-col tm-kanban-col--${column.key}`}>
            <header className="tm-kanban-col-header">
              <div className="tm-kanban-col-icon">
                <Icon size={15} />
              </div>
              <div className="tm-kanban-col-info">
                <h3 className="tm-kanban-col-title">{column.label}</h3>
                <p className="tm-kanban-col-desc">{meta.description}</p>
              </div>
              <span className="tm-kanban-col-count">{column.rows.length}</span>
            </header>

            <div className="tm-kanban-col-body">
              {column.rows.length ? column.rows.map((row) => (
                <TripMonitorUnitCard
                  key={row.rowId}
                  row={row}
                  isActive={row.rowId === selectedRowId}
                  onOpen={() => onOpen?.(row)}
                />
              )) : (
                <div className="tm-kanban-empty">
                  Tidak ada trip di severity ini.
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
