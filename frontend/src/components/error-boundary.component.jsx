import { Component } from 'react';

/**
 * React Error Boundary — catches render errors in child component tree.
 * Prevents a single component crash from taking down the entire app.
 * Must be a class component (hooks don't support componentDidCatch).
 */
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center font-inter">
                    <h2 className="text-2xl font-semibold mb-4 text-black">
                        Something went wrong
                    </h2>
                    <p className="text-[0.95rem] text-dark-grey mb-6 max-w-[400px]">
                        An unexpected error occurred. Please try refreshing the page.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2.5 rounded-lg border-none bg-kalamio text-on-kalamio text-[0.9rem] font-medium cursor-pointer transition-opacity hover:opacity-90 active:scale-95"
                    >
                        Refresh Page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
