import React from 'react';

export const Surface = React.forwardRef(function Surface({ children, className = '', tone = 'default', interactive = false, ...props }, ref) {
  const cls = `surface surface-${tone} ${interactive ? 'surface-interactive' : ''} ${className}`.trim();
  return <div ref={ref} className={cls} {...props}>{children}</div>;
});

export const SurfaceHeader = ({ children, className = '', sticky = false, ...props }) => (
  <div className={`surface-head ${sticky ? 'surface-head-sticky' : ''} ${className}`.trim()} {...props}>{children}</div>
);

export const SurfaceBody = ({ children, className = '', padded = true, ...props }) => (
  <div className={`surface-body ${padded ? 'surface-body-padded' : ''} ${className}`.trim()} {...props}>{children}</div>
);

export const SurfaceFooter = ({ children, className = '', ...props }) => (
  <div className={`surface-foot ${className}`.trim()} {...props}>{children}</div>
);
