import React from 'react';
import { C, FONT } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          direction: 'rtl', fontFamily: FONT,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh',
          background: C.bgApp, color: C.textPrimary, gap: '16px',
        }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h2 style={{ margin: 0, color: C.danger }}>אירעה שגיאה בלתי צפויה</h2>
          <p style={{ color: C.textMuted, margin: 0 }}>{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', background: C.brand, color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
            }}
          >
            טען מחדש
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
