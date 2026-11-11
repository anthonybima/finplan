import { useEffect, useState } from 'react';

/** 'phone' renders the app inside a phone-sized frame (handy in Claude's side panel or on a desktop browser). */
export type ViewMode = 'auto' | 'phone';
const KEY = 'finplan.view';
const listeners = new Set<(m: ViewMode) => void>();
let current: ViewMode = (() => { try { return (localStorage.getItem(KEY) as ViewMode) || 'auto'; } catch { return 'auto'; } })();

export function setViewMode(m: ViewMode) {
  current = m;
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  listeners.forEach((l) => l(m));
}
export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [m, setM] = useState(current);
  useEffect(() => { listeners.add(setM); return () => { listeners.delete(setM); }; }, []);
  return [m, setViewMode];
}
