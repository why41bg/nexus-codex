import type { Dashboard } from '@/types';
import StatsCards from './StatsCards';
import ModelManager from './ModelManager';

interface Props {
  dashboard: Dashboard;
  models: string[];
  onModelsChange: (models: string[]) => void;
}

export default function DashboardTab({ dashboard, models, onModelsChange }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">数据大盘</h2>
      <p className="mt-1 text-sm text-gray-500">查看账号池整体运行状态与模型配置</p>

      <StatsCards dashboard={dashboard} />

      <ModelManager models={models} onModelsChange={onModelsChange} />
    </div>
  );
}
