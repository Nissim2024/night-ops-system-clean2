import { useEffect, useState } from 'react';

// Shared "how many releases to chart" preference across Quality Hub screens
// (Overview's bar chart + KPI Detail's trend chart) — a genuine cross-screen
// display setting, not app state with an authoritative owner elsewhere, so
// localStorage persistence here doesn't have the desync risk that pattern
// caused for per-session version selections in other screens.
const KEY = 'qh_release_count';
const DEFAULT_COUNT = 12;

export function getReleaseCount(): number {
  const raw = Number(localStorage.getItem(KEY));
  return raw > 0 ? raw : DEFAULT_COUNT;
}

export function useReleaseCount(): [number, (n: number) => void] {
  const [count, setCount] = useState(getReleaseCount());

  useEffect(() => {
    const onStorage = () => setCount(getReleaseCount());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (n: number) => {
    const clamped = Math.max(1, Math.round(n));
    localStorage.setItem(KEY, String(clamped));
    setCount(clamped);
  };

  return [count, update];
}
