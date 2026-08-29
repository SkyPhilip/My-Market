/** All SMA periods selectable from Settings; charts only ever render a subset of these. */
export const MA_PERIODS = [20, 50, 100, 150, 200] as const;
export type MaPeriod = typeof MA_PERIODS[number];

const MA_COLORS: Record<number, string> = {
  20: '#4dd0e1',
  50: '#f0c040',
  100: '#66bb6a',
  150: '#b07cff',
  200: '#ec407a',
};

export function maColor(period: number): string {
  return MA_COLORS[period] ?? '#8892b0';
}
