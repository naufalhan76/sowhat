import React from 'react';

export const Stat = ({ label, value, hint, tone = 'neutral', delta, deltaTone, className = '', icon, size = 'md' }) => (
  <div className={`stat stat-${size} stat-tone-${tone} ${className}`.trim()}>
    <div className="stat-head">
      {icon ? <span className="stat-icon">{icon}</span> : null}
      <span className="stat-label">{label}</span>
    </div>
    <div className="stat-value">{value}</div>
    {(hint || delta) ? (
      <div className="stat-foot">
        {delta != null ? <span className={`stat-delta stat-delta-${deltaTone || 'neutral'}`}>{delta}</span> : null}
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    ) : null}
  </div>
);

export const StatGrid = ({ children, columns = 4, className = '', ...props }) => (
  <div className={`stat-grid stat-grid-${columns} ${className}`.trim()} {...props}>{children}</div>
);
