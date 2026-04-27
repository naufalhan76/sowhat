import React from 'react';

export const Section = ({ children, eyebrow, title, subtitle, actions, className = '', dense = false, ...props }) => (
  <section className={`section ${dense ? 'section-dense' : ''} ${className}`.trim()} {...props}>
    {(title || actions) ? (
      <header className="section-head">
        <div className="section-head-titles">
          {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
          {title ? <h2 className="section-title">{title}</h2> : null}
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="section-head-actions">{actions}</div> : null}
      </header>
    ) : null}
    <div className="section-body">{children}</div>
  </section>
);

export const Divider = ({ className = '', label = null, ...props }) => (
  <div className={`divider ${label ? 'divider-labelled' : ''} ${className}`.trim()} {...props}>
    {label ? <span className="divider-label">{label}</span> : null}
  </div>
);
