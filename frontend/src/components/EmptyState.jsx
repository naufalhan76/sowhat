import React from 'react';

export const EmptyState = ({ icon, title, description, action, className = '', size = 'md' }) => (
  <div className={`empty-state empty-state-${size} ${className}`.trim()}>
    {icon ? <div className="empty-state-icon">{icon}</div> : null}
    {title ? <p className="empty-state-title">{title}</p> : null}
    {description ? <p className="empty-state-description">{description}</p> : null}
    {action ? <div className="empty-state-action">{action}</div> : null}
  </div>
);
