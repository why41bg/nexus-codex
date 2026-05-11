import { Component, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import PortalHome from '@/components/PortalHome';
import SupportPage from '@/components/SupportPage';
import ClaimKeyPage from '@/components/ClaimKeyPage';
import ContributeAccountPage from '@/components/ContributeAccountPage';
import LoginPage from '@/components/LoginPage';
import DashboardPage from '@/components/DashboardPage';
import Spinner from '@/components/Spinner';

// ─── Error Boundary ────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-red-600 dark:text-red-400">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s before data is considered stale
      gcTime: 5 * 60_000,     // 5min garbage collection (formerly cacheTime)
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const { authenticated, restore } = useAuth();
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    restore().finally(() => setRestoring(false));
  }, [restore]);

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/" element={<PortalHome />} />
      <Route path="/support" element={<SupportPage />} />
      <Route path="/claim" element={<ClaimKeyPage />} />
      <Route path="/contribute" element={<ContributeAccountPage />} />

      {/* 认证路由 */}
      <Route
        path="/login"
        element={authenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/dashboard/*"
        element={authenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <BrowserRouter>
                <AppContent />
              </BrowserRouter>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
