import React from 'react';
import {
  LayoutDashboard, Navigation, Truck, Map as MapIcon, BarChart3, Thermometer,
  Flag, Activity, Settings, Shield, ChevronRight, ChevronLeft, Sun, MoonStar, LogOut, User
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'fleet-ops',
    label: 'Fleet Ops',
    items: [
      { id: 'overview', label: 'Mission Control', icon: LayoutDashboard, hint: 'Live KPI + alerts' },
      { id: 'fleet', label: 'Fleet Live', icon: Navigation, hint: 'Snapshot & filters' },
      { id: 'trip-monitor', label: 'Trip Monitor', icon: Truck, hint: 'JO kanban' },
      { id: 'map', label: 'Map', icon: MapIcon, hint: 'Geo view' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      { id: 'astro-report', label: 'Astro Report', icon: BarChart3, hint: 'Per-WH KPI' },
      { id: 'temp-errors', label: 'Temp Errors', icon: Thermometer, hint: 'Compile + chart' },
      { id: 'stop', label: 'Stop / Idle', icon: Flag, hint: 'Per unit events' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    adminOnly: false,
    items: [
      { id: 'api-monitor', label: 'API Monitor', icon: Activity, hint: 'Endpoint trace' },
      { id: 'config', label: 'Config', icon: Settings, hint: 'Solofleet & TMS', adminOnly: true },
      { id: 'admin', label: 'Admin', icon: Shield, hint: 'Users & DB', adminOnly: true },
    ],
  },
];

export function NavRail({
  activePanel,
  onSelect,
  collapsed = false,
  onToggleCollapsed,
  isAdmin = false,
  theme = 'dark',
  onToggleTheme,
  user,
  onProfileClick,
  onLogout,
}) {
  return (
    <nav className={`navrail ${collapsed ? 'navrail-collapsed' : ''}`.trim()} aria-label="Workspace navigation">
      <div className="navrail-head">
        <div className="navrail-brand">
          <span className="navrail-mark">SF</span>
          {!collapsed ? (
            <span className="navrail-wordmark">
              <span className="navrail-wordmark-primary">Solofleet</span>
              <span className="navrail-wordmark-secondary">Ops Bridge</span>
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="navrail-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <div className="navrail-scroll">
        {SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => !item.adminOnly || isAdmin);
          if (!visibleItems.length) return null;
          return (
            <div key={section.id} className="navrail-section">
              {!collapsed ? <p className="navrail-section-label">{section.label}</p> : <div className="navrail-section-divider" />}
              <ul className="navrail-list">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activePanel === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`navrail-item ${active ? 'navrail-item-active' : ''}`.trim()}
                        onClick={() => onSelect?.(item.id)}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span className="navrail-item-glyph"><Icon size={16} strokeWidth={1.75} /></span>
                        {!collapsed ? (
                          <span className="navrail-item-text">
                            <span className="navrail-item-label">{item.label}</span>
                            {item.hint ? <span className="navrail-item-hint">{item.hint}</span> : null}
                          </span>
                        ) : null}
                        {active ? <span className="navrail-item-rail" aria-hidden /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="navrail-foot">
        <button
          type="button"
          className={`navrail-theme-toggle navrail-theme-${theme}`}
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="navrail-theme-thumb">
            {theme === 'dark' ? <MoonStar size={14} strokeWidth={1.75} /> : <Sun size={14} strokeWidth={1.75} />}
          </span>
          {!collapsed ? <span className="navrail-theme-label">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span> : null}
        </button>

        <div className="navrail-profile">
          <button
            type="button"
            className="navrail-profile-button"
            onClick={onProfileClick}
            title={user?.displayName || user?.username || 'Profile'}
          >
            <span className="navrail-profile-avatar"><User size={14} /></span>
            {!collapsed ? (
              <span className="navrail-profile-meta">
                <span className="navrail-profile-name">{user?.displayName || user?.username || 'Operator'}</span>
                <span className="navrail-profile-role">{user?.role || 'viewer'}</span>
              </span>
            ) : null}
          </button>
          {!collapsed ? (
            <button type="button" className="navrail-profile-logout" onClick={onLogout} aria-label="Logout" title="Logout">
              <LogOut size={14} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
