import React from 'react';
import { reloadPage, restartApp } from '../utils/appRecovery';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 dark:bg-[#181a1e]">
          <div className="w-full max-w-lg rounded-xl border border-rose-100 bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] sm:p-8">
            <h1 className="mb-3 text-2xl font-semibold text-rose-600 dark:text-rose-300">Something went wrong.</h1>
            <p className="mb-4 text-slate-600 dark:text-slate-300">
              We're sorry, but an unexpected error has occurred.
            </p>
            <div className="mb-6 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700/80 dark:bg-[#2d3035]">
                <code className="whitespace-pre-wrap font-mono text-rose-600 dark:text-rose-300">
                    {this.state.error && this.state.error.toString()}
                </code>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => restartApp()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]"
              >
                Restart App
              </button>
              <button
                onClick={() => reloadPage()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
