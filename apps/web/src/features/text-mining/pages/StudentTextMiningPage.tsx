import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { DashboardPanel } from '../components/DashboardPanel';

export function StudentTextMiningPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    if (!studentId) return;
    setLoading(true);
    api
      .get(`/text-mining/students/${studentId}/dashboard`)
      .then((res) => {
        setData(res as Record<string, unknown>);
        setError(null);
      })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [studentId]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-blue-500" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/teacher" className="hover:text-gray-700">
          Dashboard
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link to={`/teacher/students/${studentId}/logs`} className="hover:text-gray-700">
          Student Logs
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="text-gray-800 font-medium">Text-mining</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-6">Text-mining (All Sessions)</h1>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {data && (
        <DashboardPanel
          sessionId={studentId ?? ''}
          scope="dialogue"
          data={data}
          onRefresh={fetchData}
          loading={loading}
        />
      )}
    </div>
  );
}
