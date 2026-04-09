export const C3S_COLORS = {
  bg: '#0D1117',
  panel: '#151A21',
  panelAlt: '#161B22',
  border: '#30363D',
  textPrimary: '#E6EDF3',
  textStrong: '#F0F6FC',
  textMuted: '#9DA7B1',
  textSubtle: '#AAB4BE',
  accent: '#4FC3F7',
  danger: '#EF5350',
  warning: '#FFA726',
  success: '#66BB6A',
  info: '#4FC3F7',
  assigned: '#AB47BC',
  running: '#FB8C00',
} as const;

export const C3S_SPACING = {
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
  title: { fontSize: 34, fontWeight: '800' as const, letterSpacing: 0.2 },
  subtitle: { fontSize: 18, fontWeight: '600' as const },
  section: { fontSize: 22, fontWeight: '800' as const },
  value: { fontSize: 16, fontWeight: '700' as const },
  label: { fontSize: 13, fontWeight: '700' as const },
} as const;

