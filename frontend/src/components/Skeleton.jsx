import React from 'react';

export const Skeleton = ({ width, height = '1em', radius = 'var(--radius-sm)', className = '', variant = 'text' }) => {
  const style = {
    width: width || (variant === 'text' ? '100%' : undefined),
    height,
    borderRadius: variant === 'circle' ? '50%' : radius,
  };
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
};

export const SkeletonGroup = ({ children, className = '', gap = '8px' }) => (
  <div className={`skeleton-group ${className}`.trim()} style={{ display: 'flex', flexDirection: 'column', gap }} aria-busy="true" aria-label="Loading">
    {children}
  </div>
);
