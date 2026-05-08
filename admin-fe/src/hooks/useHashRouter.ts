import { useState, useEffect, useCallback } from 'react';
import type { TabKey } from '@/components/Sidebar';

function getTabFromHash(): TabKey {
  const hash = window.location.hash.slice(1);
  if (hash === 'accounts' || hash === 'apikeys' || hash === 'banned-ips') return hash;
  return 'dashboard';
}

export function useHashRouter() {
  const [activeTab, setActiveTab] = useState<TabKey>(getTabFromHash);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const switchTab = useCallback((tab: TabKey) => {
    window.location.hash = tab;
  }, []);

  return { activeTab, switchTab };
}
