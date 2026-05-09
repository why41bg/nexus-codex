import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import PortalHome from '@/components/PortalHome';
import SupportPage from '@/components/SupportPage';
import ClaimKeyPage from '@/components/ClaimKeyPage';
import LoginPage from '@/components/LoginPage';
import DashboardPage from '@/components/DashboardPage';
import Spinner from '@/components/Spinner';

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
  );
}
