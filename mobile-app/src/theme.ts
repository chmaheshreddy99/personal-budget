/** Colours, sizes and type, in the same family as the web app (ocean blues, navy, gold for gains). */
export const colors = {
  navy: '#0b2038',
  navy2: '#123a5e',
  ocean: '#0b7cbd',
  ocean2: '#3aa0dc',
  oceanSoft: '#e4f2fb',
  aqua: '#13a89a',
  aquaSoft: '#ddf5f1',
  gold: '#c99a3b',
  goldSoft: '#fbf1d8',
  coral: '#e0712f',
  coralSoft: '#fde8dc',
  violet: '#5b4fc9',
  violetSoft: '#ebe8fb',
  red: '#c62828',
  redSoft: '#fdecec',
  green: '#11803e',
  greenSoft: '#e3f6ec',
  bg: '#eef3f8',
  card: '#ffffff',
  sunken: '#f3f6fa',
  line: '#dfe7ef',
  text: '#0f2233',
  text2: '#4b5d70',
  muted: '#8193a5',
  white: '#ffffff',
};

export const radius = { s: 8, m: 12, l: 16, xl: 22 };
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };

/** The tone of an account by what it is. */
export function accountTone(type: string, group?: string): { fg: string; bg: string } {
  if (group === 'CONSTRUCTION') return { fg: colors.gold, bg: colors.goldSoft };
  if (group === 'HOSTED_CHIT') return { fg: colors.aqua, bg: colors.aquaSoft };
  if (group === 'EMI') return { fg: colors.violet, bg: colors.violetSoft };
  switch (type) {
    case 'CREDIT_CARD': return { fg: colors.coral, bg: colors.coralSoft };
    case 'CASH': case 'WALLET': return { fg: colors.aqua, bg: colors.aquaSoft };
    case 'BANK': return { fg: colors.ocean, bg: colors.oceanSoft };
    case 'PAYABLE': case 'LOAN': case 'HOME_LOAN': case 'VEHICLE_LOAN': case 'PERSONAL_LOAN': case 'GOLD_LOAN': case 'EDUCATION_LOAN':
      return { fg: colors.red, bg: colors.redSoft };
    default: return { fg: colors.violet, bg: colors.violetSoft };
  }
}
