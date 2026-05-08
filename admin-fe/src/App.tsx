import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import LoginPage from '@/components/LoginPage';
import DashboardPage from '@/components/DashboardPage';
import Spinner from '@/components/Spinner';

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
      <Route
        path="/login"
        element={authenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/dashboard/*"
        element={authenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="*"
        element={<Navigate to={authenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <HashRouter>
            <AppContent />
          </HashRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
