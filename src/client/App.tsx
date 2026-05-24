import { useEffect, useState } from "react";

interface HealthResponse {
  ok: boolean;
  user: string;
  timestamp: string;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<HealthResponse>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 600 }}>
      <h1>Media Tracker</h1>
      <p>Phase 0 scaffold. See PLAN.md for the build sequence.</p>
      <h2>Worker health check</h2>
      {error ? (
        <pre style={{ color: "crimson" }}>Error: {error}</pre>
      ) : health ? (
        <pre>{JSON.stringify(health, null, 2)}</pre>
      ) : (
        <p>Loading…</p>
      )}
    </div>
  );
}
