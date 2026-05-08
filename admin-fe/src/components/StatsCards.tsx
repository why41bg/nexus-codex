import type { Dashboard, SummaryResponse, PercentileResponse } from '@/types';
import KpiRow from './KpiRow';
import HealthBar from './HealthBar';

interface Props {
  dashboard: Dashboard;
  summary: SummaryResponse | null;
  percentiles: PercentileResponse | null;
}

export default function StatsCards({ dashboard, summary, percentiles }: Props) {
  return (
    <div className="mt-6 space-y-4">
      <KpiRow dashboard={dashboard} summary={summary} percentiles={percentiles} />
      <HealthBar dashboard={dashboard} />
    </div>
  );
}
