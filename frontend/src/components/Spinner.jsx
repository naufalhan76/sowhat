import React from 'react';

export const Spinner = ({ size = 'md', className = '', ...props }) => (
  <span className={`spinner spinner-${size} ${className}`.trim()} aria-label="Loading" {...props}>
    <span className="spinner-arc" />
  </span>
);
