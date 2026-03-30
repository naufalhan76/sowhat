const fs = require('fs');
const content = fs.readFileSync('a:/Solofleet/frontend/src/App.jsx', 'utf8');

let newContent = content.replace(/<div className="app-shell">[\s\S]*?<section className="ops-card-grid">/, `
    <div className={\`command-center \${sidebarCollapsed ? 'sidebar-collapsed' : ''}\`}>
      <header className="topbar">
        <div className="topbar-brand">
          <img src={logoUrl} alt="Logo" />
          <div className="brand-title">Solo<span>fleet</span></div>
        </div>
        <div className="topbar-controls">
          <div className="date-range-group">
            <input type="date" value={range.startDate} onChange={(event) => setRange(c => ({...c, startDate: event.target.value}))} />
            <ArrowRight size={14} className="text-muted" />
            <input type="date" value={range.endDate} onChange={(event) => setRange(c => ({...c, endDate: event.target.value}))} />
          </div>
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input type="text" placeholder="Search account, unit, location..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        <div className="topbar-actions">
          <div className="account-badge">
            <Settings size={14} />
            <span>Account</span>
            <strong>{accountName(currentAccount)}</strong>
          </div>
          <div className="control-inline-actions">
            <Button variant="bordered" onPress={exportFleet}><Navigation size={14} /> Live CSV</Button>
            <Button variant="bordered" onPress={exportAlerts}><ShieldAlert size={14} /> Alerts CSV</Button>
          </div>
          <Button variant="bordered" onPress={() => loadDashboard(false, false)}><RefreshCw size={14} /> Refresh</Button>
          <Button onPress={runPollNow}><Zap size={14} /> Poll Now</Button>
          <Button variant="bordered" onPress={togglePolling}>{status?.runtime?.isPolling ? 'Stop polling' : 'Start polling'}</Button>
        </div>
      </header>

      <nav className="sidebar">
        <div className="sidebar-nav">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'fleet', label: 'Fleet Live', icon: Navigation },
            { id: 'historical', label: 'Historical', icon: Clock },
            { id: 'temp-errors', label: 'Temp Errors', icon: Thermometer },
            { id: 'pod', label: 'POD', icon: Map },
            { id: 'stop', label: 'Stop/Idle', icon: Flag },
            { id: 'api-monitor', label: 'API Monitor', icon: Activity },
            { id: 'config', label: 'Config', icon: Settings },
          ].map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={\`nav-item \${activePanel === item.id ? 'active' : ''}\`} onClick={() => setActivePanel(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </div>
        <div className="sidebar-bottom">
          <button type="button" className="nav-item collapse-btn" onClick={() => setSidebarCollapsed(c => !c)}>
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <span>Collapse</span>
          </button>
        </div>
      </nav>

      <main className="workspace">
        <div className="stat-strip">
          {[
            { label: 'Monitored Units', value: status?.overview?.monitoredUnits, note: 'Aktif di config' },
            { label: 'Live Alerts', value: status?.overview?.liveAlerts, note: 'Alert current', danger: true },
            { label: 'Critical Alerts', value: status?.overview?.criticalAlerts, note: 'T1+T2 Error', danger: true },
            { label: 'Moving', value: status?.overview?.movingUnits, note: 'Speed > 0' },
            { label: 'Stale Feeds', value: status?.overview?.staleUnits, note: '> 15 mins', warning: true },
          ].map((s, i) => (
            <div key={i} className={\`stat-card \${s.danger ? 'stat-card-danger' : s.warning ? 'stat-card-warning' : ''}\`}>
              <span className="stat-label">{s.label}</span>
              <div className="stat-value">{s.value ?? '-'}</div>
              <span className="stat-note">{s.note}</span>
            </div>
          ))}
        </div>

        <div className="filter-strip">
          <button type="button" className={\`filter-pill \${quickFilter === 'all' ? 'active' : ''}\`} onClick={() => setQuickFilter('all')}>
            <span>All Fleet</span><span className="filter-badge">All</span>
          </button>
          {autoFilterCards.map(c => (
            <button type="button" key={c.id} className={\`filter-pill \${quickFilter === c.id ? 'active' : ''}\`} onClick={() => setQuickFilter(c.id)}>
              <span>{c.label}</span><span className="filter-badge">{c.count}</span>
            </button>
          ))}
        </div>
        <div className="panel-container">
          <section className="ops-card-grid" style={{display:'none'}}>`);

newContent = newContent.replace(/<section className="ops-card-grid" style={{display:'none'}}>[\s\S]*?<section className=\{sidebarCollapsed \? "main-grid main-grid-collapsed" : "main-grid"\}>\s*<div className="main-column">/, '');

newContent = newContent.replace(/<nav className="panel-nav">[\s\S]*?<\/nav>/, '');

newContent = newContent.replace(/<aside className=\{sidebarCollapsed \? "side-column side-column-collapsed" : "side-column"\}>[\s\S]*?<\/aside>\s*<\/section>\s*<\/div>/, `
        </div>
      </main>
      
      <footer className="status-bar">
        <div className="status-left">
          <div className="status-indicator">
            <span className={\`status-dot \${status?.runtime?.isPolling ? 'active' : ''}\`}></span>
            <span>Polling {status?.runtime?.isPolling ? 'ON' : 'OFF'}</span>
          </div>
          <span>Next: {fmtDate(status?.runtime?.nextRunAt)}</span>
        </div>
        <div className="status-right">
          <span>Snapshot: {fmtDate(status?.runtime?.lastSnapshotAt)}</span>
          {status?.runtime?.lastSnapshotError && <span className="text-danger" style={{color: 'var(--danger)'}}>Err: {status.runtime.lastSnapshotError}</span>}
        </div>
      </footer>

      {banner.message && (
        <div className="toast-container">
          <div className={\`toast \${banner.tone === 'error' ? 'toast-error' : banner.tone === 'success' ? 'toast-success' : 'toast-info'}\`}>
            {banner.tone === 'error' ? <ShieldAlert size={16} /> : <Box size={16} />}
            <span>{banner.message}</span>
          </div>
        </div>
      )}
    </div>
`);

fs.writeFileSync('a:/Solofleet/frontend/src/App.jsx', newContent);
console.log('App.jsx successfully rewritten via script.');
