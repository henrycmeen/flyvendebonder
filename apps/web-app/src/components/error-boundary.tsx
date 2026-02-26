import { Component, type ErrorInfo, type ReactNode } from "react";

import { logToClient } from "@/lib/client-logger";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  isRecovering: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      isRecovering: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, isRecovering: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught UI-feil", error, info);
    logToClient("error", "UI krasj", null, {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  handleRetry = (): void => {
    this.setState({
      error: null,
      isRecovering: false,
    });
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-fb-surface-base p-5 text-fb-text-primary">
        <div className="w-full max-w-md rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-5 shadow-2xl">
          <h1 className="text-xl font-semibold">Noe gikk galt i grensesnittet</h1>
          <p className="mt-2 text-sm text-fb-text-secondary">En uventet feil stoppet visningen. Prøv å laste på nytt.</p>
          <pre className="mt-3 max-h-40 overflow-auto rounded border border-[color:var(--fb-chip-border)] bg-[color:var(--fb-surface-page)] p-2 text-xs text-fb-text-primary">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-md bg-[color:var(--fb-accent-emerald)] px-3 py-2 text-sm font-medium text-fb-text-primary transition hover:bg-[color:var(--fb-accent-emerald)]/90"
            >
              Prøv på nytt
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-fb-border-subtle bg-transparent px-3 py-2 text-sm font-medium text-fb-text-primary transition hover:border-[color:var(--fb-focus-ring)] hover:bg-[color:var(--fb-surface-overlay)]"
            >
              Last siden på nytt
            </button>
          </div>
        </div>
      </div>
    );
  }
}
