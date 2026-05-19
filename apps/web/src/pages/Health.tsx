import { useEffect, useState } from 'react';

interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
}

export default function Health() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Health Check</h1>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {health && (
        <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px' }}>
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
      {!health && !error && <p>Loading...</p>}
    </div>
  );
}
