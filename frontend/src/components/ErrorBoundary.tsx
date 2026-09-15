import React from 'react';

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
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground"
          dir="rtl"
        >
          <div className="text-[48px]">⚠️</div>
          <h2 className="m-0 text-danger">אירעה שגיאה בלתי צפויה</h2>
          <p className="m-0 text-subtle-foreground">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-lg border-none bg-primary px-6 py-2.5 text-[15px] text-white"
          >
            טען מחדש
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
