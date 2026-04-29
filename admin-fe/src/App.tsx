import { useEffect, useState } from 'react';
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

  return authenticated ? <DashboardPage /> : <LoginPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
