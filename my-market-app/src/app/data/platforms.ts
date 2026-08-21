export interface PlatformOption {
  id: string;
  label: string;
  color: string;
}

/** Brokerage platforms a holding can live on; `color` tints the symbol text. Add entries here to offer more. */
export const PLATFORMS: PlatformOption[] = [
  { id: 'schwab', label: 'Schwab', color: '#4a9eff' },
  { id: 'jpmorgan', label: 'JP Morgan', color: '#e3b341' },
  { id: 'other', label: 'Other', color: '#e0e0e0' },
];

export function platformById(id: string | null | undefined): PlatformOption | null {
  return id ? PLATFORMS.find(p => p.id === id) ?? null : null;
}
