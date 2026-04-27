import React from 'react';
import {
  LayoutDashboard, Navigation, Truck, Map as MapIcon, BarChart3, Thermometer,
  Flag, Activity, Settings, Shield, ChevronRight, ChevronLeft, Sun, MoonStar, LogOut, User
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'fleet', label: 'Fleet', icon: Navigation },
      { id: 'trip-monitor', label: 'Trips', icon: Truck },
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
    label: 'Settings',
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
  return (
    <nav className={`navrail ${collapsed ? 'navrail-collapsed' : ''}`.trim()} aria-label="Workspace navigation">
      <div className="navrail-head">
        <button type="button" className="navrail-brand" onClick={() => onSelect?.('overview')} title="Sowhat">
          <span className="navrail-mark">S</span>
          {!collapsed ? <span className="navrail-wordmark">Sowhat</span> : null}
        </button>
        <button
          type="button"
          className="navrail-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} strokeWidth={1.75} /> : <ChevronLeft size={14} strokeWidth={1.75} />}
        </button>
      </div>

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

      <div className="navrail-foot">
        <button
          type="button"
          className="navrail-foot-btn"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="navrail-foot-btn-glyph">
            {theme === 'dark' ? <MoonStar size={15} strokeWidth={1.75} /> : <Sun size={15} strokeWidth={1.75} />}
          </span>
          {!collapsed ? <span className="navrail-foot-btn-label">{theme === 'dark' ? 'Dark' : 'Light'}</span> : null}
        </button>

        <button
          type="button"
          className="navrail-foot-btn"
          onClick={onProfileClick}
          title={user?.displayName || user?.username || 'Account'}
        >
          <span className="navrail-foot-btn-glyph"><User size={15} strokeWidth={1.75} /></span>
          {!collapsed ? <span className="navrail-foot-btn-label">{user?.displayName || user?.username || 'Account'}</span> : null}
        </button>

        <button
          type="button"
          className="navrail-foot-btn"
          onClick={onLogout}
          aria-label="Sign out"
          title="Sign out"
        >
          <span className="navrail-foot-btn-glyph"><LogOut size={15} strokeWidth={1.75} /></span>
          {!collapsed ? <span className="navrail-foot-btn-label">Sign out</span> : null}
        </button>
      </div>
    </nav>
  );
}
