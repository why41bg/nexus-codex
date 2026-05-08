import { useState, useCallback } from 'react';
import type { Dashboard, SummaryResponse, PercentileResponse } from '@/types';
import StatsCards from './StatsCards';
import MetricsChart from './MetricsChart';
import ModelManager from './ModelManager';

interface Props {
  dashboard: Dashboard;
  models: string[];
  onModelsChange: (models: string[]) => void;
}

export default function DashboardTab({ dashboard, models, onModelsChange }: Props) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [percentiles, setPercentiles] = useState<PercentileResponse | null>(null);

  const handleSummaryChange = useCallback((s: SummaryResponse | null) => {
    setSummary(s);
  }, []);

  const handlePercentilesChange = useCallback((p: PercentileResponse | null) => {
    setPercentiles(p);
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">数据大盘</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">查看账号池整体运行状态与模型配置</p>

      <StatsCards dashboard={dashboard} summary={summary} percentiles={percentiles} />

      <MetricsChart
        onSummaryChange={handleSummaryChange}
        onPercentilesChange={handlePercentilesChange}
      />

      <ModelManager models={models} onModelsChange={onModelsChange} />
    </div>
  );
}
