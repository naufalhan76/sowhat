import { createPortal } from 'react-dom';

export const ModalPortal = ({ children }) => {
  if (typeof document === 'undefined') return children;
  return createPortal(children, document.body);
};

export { Surface, SurfaceHeader, SurfaceBody, SurfaceFooter } from './Surface.jsx';
export { Action, ActionGroup } from './Action.jsx';
export { Pill, PillGroup } from './Pill.jsx';
export { Stat, StatGrid } from './Stat.jsx';
export { Section, Divider } from './Section.jsx';
export { EmptyState } from './EmptyState.jsx';
export { Spinner } from './Spinner.jsx';
export { Skeleton, SkeletonGroup } from './Skeleton.jsx';
export { ErrorBoundary } from './ErrorBoundary.jsx';
export { CommandPalette } from './CommandPalette.jsx';
export { ApiMonitorPanel } from './ApiMonitorPanel.jsx';
export { ConfigPanel } from './ConfigPanel.jsx';
export { AdminPanel } from './AdminPanel.jsx';
export { HistoricalPanel } from './HistoricalPanel.jsx';
export { AstroReportPanel } from './AstroReportPanel.jsx';
export { MapPanel } from './MapPanel.jsx';
export { TempErrorsPanel } from './TempErrorsPanel.jsx';
export { StopIdlePanel } from './StopIdlePanel.jsx';
export { TripMonitorOverrideBadge } from './trip-monitor/TripMonitorOverrideBadge.jsx';
export { MasterDataPage } from './master-data/index.js';
