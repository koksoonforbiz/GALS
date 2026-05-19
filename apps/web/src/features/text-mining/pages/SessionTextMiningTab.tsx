import { Loader2 } from 'lucide-react';
import { DashboardPanel } from '../components/DashboardPanel';
import { useTextMiningDashboard } from '../hooks/useDashboard';

export function SessionTextMiningTab({ sessionId }: { sessionId: string }) {
  const { data, loading, error, refetch } = useTextMiningDashboard(sessionId);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-blue-500" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-sm py-4">{error}</p>;
  }

  if (!data) return null;

  return <DashboardPanel sessionId={sessionId} data={data} onRefresh={refetch} loading={loading} />;
}
