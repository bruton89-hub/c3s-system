export const C3S_COLORS = {
  bg: '#F4F7FB',
  panel: '#FFFFFF',
  panelAlt: '#EDF3FA',
  border: '#D7E0EA',
  textPrimary: '#092A52',
  textStrong: '#041F42',
  textMuted: '#5C6F84',
  textSubtle: '#73859A',
  accent: '#086BEA',
  accentSoft: '#E7F0FF',
  navy: '#06264E',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  warning: '#B86400',
  warningSoft: '#FFF3DF',
  success: '#237A43',
  successSoft: '#E7F5EC',
  info: '#086BEA',
  infoSoft: '#E7F0FF',
  assigned: '#086BEA',
  running: '#086BEA',
} as const;

export const C3S_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pageH: 20,
  pageTop: 10,
  sectionGap: 12,
  cardGap: 10,
  itemGap: 8,
} as const;

export const C3S_RADIUS = {
  card: 12,
  chip: 999,
  button: 10,
} as const;

export const C3S_TYPE = {
  title: { fontSize: 32, lineHeight: 38, fontWeight: '900' as const, letterSpacing: 0.1 },
  subtitle: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  section: { fontSize: 22, fontWeight: '800' as const },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900' as const },
  value: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: '700' as const },
  label: { fontSize: 13, fontWeight: '700' as const },
} as const;

export const C3S_SHADOW: ViewStyle = Platform.select({
  web: { boxShadow: '0 2px 8px rgba(4, 31, 66, 0.06)' },
  default: {
    shadowColor: '#041F42',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
import { Platform, type ViewStyle } from 'react-native';
