import React from 'react';
import {
  LayoutDashboard, Navigation, Truck, Map as MapIcon, BarChart3, Thermometer,
  Flag, Activity, Settings, Shield, ChevronRight, ChevronLeft, Sun, MoonStar, LogOut, User, Database
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'fleet', label: 'Fleet', icon: Navigation },
      { id: 'trip-monitor', label: 'Trips', icon: Truck },
      { id: 'master-data', label: 'Master Data', icon: Database },
      { id: 'map', label: 'Map', icon: MapIcon },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { id: 'astro-report', label: 'Astro', icon: BarChart3 },
      { id: 'temp-errors', label: 'Temp errors', icon: Thermometer },
      { id: 'stop', label: 'Stop / idle', icon: Flag },
    ],
  },
  {
    id: 'settings',
    label: 'System',
    items: [
      { id: 'api-monitor', label: 'API monitor', icon: Activity },
      { id: 'config', label: 'Config', icon: Settings, adminOnly: true },
      { id: 'admin', label: 'Admin', icon: Shield, adminOnly: true },
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
  const initial = (user?.displayName || user?.username || 'U').charAt(0).toUpperCase();

  return (
    <nav className={`navrail ${collapsed ? 'navrail-collapsed' : ''}`.trim()} aria-label="Workspace navigation">
      {/* ---- Head: brand + collapse ---- */}
      <div className="navrail-head">
        <button type="button" className="navrail-brand" onClick={() => onSelect?.('overview')} title="Sowhat">
          <span className="navrail-mark">S</span>
          {!collapsed ? <span className="navrail-wordmark">Sowhat</span> : null}
        </button>
        {!collapsed ? (
          <button
            type="button"
            className="navrail-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label="Collapse navigation"
            title="Collapse sidebar"
          >
            <ChevronLeft size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {/* ---- Nav sections ---- */}
      <div className="navrail-scroll">
        {SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => !item.adminOnly || isAdmin);
          if (!visibleItems.length) return null;
          return (
            <div key={section.id} className="navrail-section">
              {!collapsed && section.label ? (
                <p className="navrail-section-label">{section.label}</p>
              ) : null}
              <ul className="navrail-list">
                {visibleItems.map((item, index) => {
                  const Icon = item.icon;
                  const active = activePanel === item.id;
                  return (
                    <li key={item.id} style={{ '--item-index': index }}>
                      <button
                        type="button"
                        className={`navrail-item ${active ? 'navrail-item-active' : ''}`.trim()}
                        onClick={() => onSelect?.(item.id)}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                      >
                        {active ? <span className="navrail-item-rail" /> : null}
                        <span className="navrail-item-glyph"><Icon size={16} strokeWidth={1.75} /></span>
                        {!collapsed ? <span className="navrail-item-label">{item.label}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {/* ---- Foot: profile + theme + collapse (when collapsed) ---- */}
      <div className="navrail-foot">
        {/* Profile row */}
        <div className="navrail-profile">
          <button type="button" className="navrail-profile-button" onClick={onProfileClick} title={user?.displayName || user?.username || 'Account'}>
            <span className="navrail-profile-avatar">{initial}</span>
            {!collapsed ? (
              <span className="navrail-profile-meta">
                <span className="navrail-profile-name">{user?.displayName || user?.username || 'Account'}</span>
                <span className="navrail-profile-role">{user?.role || 'user'}</span>
              </span>
            ) : null}
          </button>
          {!collapsed ? (
            <button type="button" className="navrail-profile-logout" onClick={onLogout} aria-label="Sign out" title="Sign out">
              <LogOut size={14} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>

        {/* Theme toggle */}
        <button
          type="button"
          className="navrail-theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="navrail-theme-thumb">
            {theme === 'dark' ? <MoonStar size={13} strokeWidth={1.75} /> : <Sun size={13} strokeWidth={1.75} />}
          </span>
          {!collapsed ? <span className="navrail-theme-label">{theme === 'dark' ? 'Dark' : 'Light'}</span> : null}
        </button>

        {/* Expand button (only when collapsed) */}
        {collapsed ? (
          <button
            type="button"
            className="navrail-collapse-btn navrail-expand-trigger"
            onClick={onToggleCollapsed}
            aria-label="Expand navigation"
            title="Expand sidebar"
          >
            <ChevronRight size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
