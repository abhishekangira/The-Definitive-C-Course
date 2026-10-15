import { useEffect, useState } from 'react';
import { themeKey } from '../progress/store';

export type ThemeChoice = 'system' | 'light' | 'dark';

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(themeKey());
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}

function apply(t: ThemeChoice) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(themeKey());
      else localStorage.setItem(themeKey(), theme);
    } catch { /* storage unavailable: theme still applies for this visit */ }
  }, [theme]);
  return [theme, setTheme];
}

/** The theme actually in effect (resolving "system"). */
export function effectiveTheme(): 'light' | 'dark' {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
