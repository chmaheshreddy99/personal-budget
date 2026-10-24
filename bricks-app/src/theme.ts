/**
 * Colours, sizes and type for a grey blocks (cement brick) business: charcoal and concrete greys, with safety
 * orange for what to act on, and the usual greens, ambers and reds for good, waiting and wrong.
 */
export const colors = {
  ink: '#1e252c',
  ink2: '#2c3640',
  slate: '#46525e',
  concrete: '#c9cdd2',
  concreteSoft: '#eceef1',
  orange: '#e8772e',
  orange2: '#f28c38',
  orangeSoft: '#fdeee3',
  green: '#1f8a4c',
  greenSoft: '#e3f4ea',
  amber: '#b97c0b',
  amberSoft: '#fcf1d9',
  red: '#c8372d',
  redSoft: '#fbe6e4',
  blue: '#2b6cb0',
  blueSoft: '#e5eef8',
  violet: '#5b4fc9',
  violetSoft: '#ebe8fb',
  bg: '#f2f3f5',
  card: '#ffffff',
  sunken: '#f6f7f9',
  line: '#e1e4e8',
  text: '#1b2229',
  text2: '#4e5965',
  muted: '#8a949f',
  white: '#ffffff',
};

export const radius = { s: 8, m: 12, l: 16, xl: 22 };
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' | 'violet';

export const tones: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: colors.green, bg: colors.greenSoft },
  warn: { fg: colors.amber, bg: colors.amberSoft },
  bad: { fg: colors.red, bg: colors.redSoft },
  info: { fg: colors.blue, bg: colors.blueSoft },
  neutral: { fg: colors.slate, bg: colors.concreteSoft },
  accent: { fg: colors.orange, bg: colors.orangeSoft },
  violet: { fg: colors.violet, bg: colors.violetSoft },
};

/** An order's or a trip's status as a tone. */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'DELIVERED': case 'APPROVED': case 'POSTED': return 'good';
    case 'PENDING': case 'CLAIMED': case 'LOADING': case 'PART_DELIVERED': return 'warn';
    case 'DISPATCHED': case 'IN_TRANSIT': return 'info';
    case 'CANCELLED': case 'REJECTED': return 'bad';
    case 'RECEIVED': case 'PLANNED': return 'accent';
    default: return 'neutral';
  }
}
