import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback;
      }
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-content">
            <p className="error-boundary-title">Terjadi kesalahan</p>
            <p className="error-boundary-message">
              {this.state.error?.message || 'Panel ini mengalami error. Coba muat ulang.'}
            </p>
            <button type="button" className="action action-sm action-secondary" onClick={this.handleReset}>
              <span className="action-label">Coba lagi</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
