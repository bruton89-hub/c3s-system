import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type Href, router } from 'expo-router';

import { C3SBackHeader } from '@/components/c3s-brand';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { TRAINING_TOOLS_ENABLED } from '@/lib/training/config';

const groups: { title: string; tools: { label: string; description: string; route: Href }[] }[] = [
  { title: 'Production tools', tools: [
    { label: 'RTC Queue', description: 'Prep and ready-to-cook actions', route: '/prep-queue' },
    { label: 'Thermal Operations', description: 'Assignments, cooks, and required checks', route: '/thermal' },
    { label: 'Chill Operations', description: 'Chiller loads and cooling checks', route: '/chill' },
    { label: 'Packaging', description: 'Packaging starts, completion, and yield', route: '/packaging' },
    { label: 'Thermal Timeline', description: 'Chronological cooks, checks, and limits', route: '/thermal-timeline' },
    { label: 'Chiller Load', description: 'Chiller assignment and capacity view', route: '/chiller-load' },
  ]},
  { title: 'Quality', tools: [
    { label: 'QA Review', description: 'Release, hold, and verification', route: '/qa-review' },
    { label: 'Holds', description: 'Active holds and resolution history', route: '/holds' as Href },
  ]},
  { title: 'Planning', tools: [
    { label: 'Planning', description: 'Plan and load production rows', route: '/planning' },
    { label: 'Product Profiles', description: 'Configured product requirements', route: '/products' },
    { label: 'Equipment', description: 'Availability and active assignments', route: '/equipment' as Href },
    { label: 'Shift Handoff', description: 'Live shift summary from C3S records', route: '/shift-handoff' as Href },
  ]},
  ...(TRAINING_TOOLS_ENABLED ? [{ title: 'System / Training', tools: [
    { label: 'Simulation Alerts', description: 'Local training alerts and acknowledgements', route: '/simulation-alerts' as Href },
  ]}] : []),
];

export default function MoreScreen() {
  return <C3SScreen><C3SPage><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <C3SBackHeader title="More tools" subtitle="Specialized and administrative views" />
    {groups.map((group) => <View key={group.title} style={styles.group}><Text style={styles.groupTitle}>{group.title}</Text>{group.tools.map((tool) => <Pressable key={tool.label} style={styles.tool} onPress={() => router.push(tool.route)}><View style={styles.toolText}><Text style={styles.toolLabel}>{tool.label}</Text><Text style={styles.toolDescription}>{tool.description}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</View>)}
  </ScrollView></C3SPage></C3SScreen>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 12 }, nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 55 }, back: { minWidth: 72, minHeight: 44, justifyContent: 'center' }, backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' },
  title: { color: C3S_COLORS.textStrong, fontSize: 32, fontWeight: '900' }, subtitle: { color: C3S_COLORS.textMuted, fontSize: 16, fontWeight: '600', marginTop: -8, marginBottom: 5 },
  group: { gap: 8 }, groupTitle: { color: C3S_COLORS.textStrong, fontSize: 20, fontWeight: '900', marginTop: 5 },
  tool: { minHeight: 68, flexDirection: 'row', alignItems: 'center', backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 10 }, toolText: { flex: 1 }, toolLabel: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '900' }, toolDescription: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '600', marginTop: 2 }, chevron: { color: C3S_COLORS.accent, fontSize: 28, marginLeft: 10 },
});
