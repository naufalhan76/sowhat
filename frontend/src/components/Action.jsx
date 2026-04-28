import React from 'react';

const VARIANT_TO_CLASS = {
  primary: 'action-primary',
  secondary: 'action-secondary',
  ghost: 'action-ghost',
  danger: 'action-danger',
  bordered: 'action-secondary',
  light: 'action-ghost',
  flat: 'action-secondary',
};

export const Action = React.forwardRef(function Action({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  onPress,
  onClick,
  startIcon,
  endIcon,
  loading = false,
  disabled,
  type = 'button',
  ...props
}, ref) {
  const variantClass = VARIANT_TO_CLASS[variant] || 'action-primary';
  const handle = onClick || onPress;
  return (
    <button
      ref={ref}
      type={type}
      className={`action action-${size} ${variantClass} ${loading ? 'action-loading' : ''} ${className}`.trim()}
      onClick={handle}
      disabled={disabled || loading}
      {...props}
    >
      {startIcon ? <span className="action-icon">{startIcon}</span> : null}
      {children ? <span className="action-label">{children}</span> : null}
      {endIcon ? <span className="action-icon action-icon-trailing">{endIcon}</span> : null}
    </button>
  );
});

export const ActionGroup = ({ children, className = '', align = 'start', ...props }) => (
  <div className={`action-group action-group-${align} ${className}`.trim()} {...props}>{children}</div>
);
