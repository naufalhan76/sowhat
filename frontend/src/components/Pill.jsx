import React from 'react';

const COLOR_TO_TONE = {
  default: 'neutral',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  error: 'danger',
};

export const Pill = ({ children, color = 'default', tone, dot = false, className = '', icon, ...props }) => {
  const resolved = tone || COLOR_TO_TONE[color] || 'neutral';
  return (
    <span className={`pill pill-${resolved} ${className}`.trim()} {...props}>
      {dot ? <span className="pill-dot" /> : null}
      {icon ? <span className="pill-icon">{icon}</span> : null}
      <span className="pill-label">{children}</span>
    </span>
  );
};

export const PillGroup = ({ children, className = '', ...props }) => (
  <div className={`pill-group ${className}`.trim()} {...props}>{children}</div>
);
