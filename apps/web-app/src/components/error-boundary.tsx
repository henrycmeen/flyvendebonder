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
      <div className="flex min-h-screen items-center justify-center bg-[#1d1b16] p-5 text-[#f2e8d8]">
        <div className="w-full max-w-md rounded-xl border border-[#ccb38a]/50 bg-[#2d281f] p-5 shadow-2xl">
          <h1 className="text-xl font-semibold">Noe gikk galt i grensesnittet</h1>
          <p className="mt-2 text-sm text-[#e5d8be]">En uventet feil stoppet visningen. Prøv å laste på nytt.</p>
          <pre className="mt-3 max-h-40 overflow-auto rounded border border-[#bda67d]/40 bg-[#1f1b14] p-2 text-xs text-[#f7ecd5]">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-md bg-[#e3c58a] px-3 py-2 text-sm font-medium text-[#2e2414] transition hover:bg-[#f0d8a8]"
            >
              Prøv på nytt
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-[#cab48b]/70 bg-transparent px-3 py-2 text-sm font-medium text-[#e8d8ba] transition hover:border-[#e0cb9d] hover:bg-[#3a3024]"
            >
              Last siden på nytt
            </button>
          </div>
        </div>
      </div>
    );
  }
}
