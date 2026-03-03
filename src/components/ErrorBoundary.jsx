import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
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
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-lg w-full border border-red-100">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong.</h1>
            <p className="text-gray-600 mb-4">
              We're sorry, but an unexpected error has occurred.
            </p>
            <div className="bg-gray-100 p-4 rounded text-sm overflow-auto max-h-48 mb-6">
                <code className="text-red-500 font-mono whitespace-pre-wrap">
                    {this.state.error && this.state.error.toString()}
                </code>
            </div>
            <button
              onClick={() => {
                  localStorage.clear();
                  window.location.href = '/';
              }}
              className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
            >
              Clear Data & Restart
            </button>
             <button
              onClick={() => window.location.reload()}
              className="w-full mt-2 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
