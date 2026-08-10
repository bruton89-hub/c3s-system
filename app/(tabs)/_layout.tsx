import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { C3S_COLORS } from '@/constants/c3s-ui';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarButton: HapticTab,
      tabBarActiveTintColor: C3S_COLORS.accent,
      tabBarInactiveTintColor: C3S_COLORS.textMuted,
      tabBarStyle: { height: 76, paddingTop: 7, paddingBottom: 10, backgroundColor: C3S_COLORS.panel, borderTopColor: C3S_COLORS.border },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '800' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <IconSymbol size={27} name="house.fill" color={color} /> }} />
      <Tabs.Screen name="production" options={{ title: 'Production', tabBarIcon: ({ color }) => <IconSymbol size={27} name="rectangle.stack.fill" color={color} /> }} />
      <Tabs.Screen name="notifications" options={{ title: 'Alerts', tabBarIcon: ({ color }) => <IconSymbol size={27} name="exclamationmark.triangle.fill" color={color} /> }} />

      <Tabs.Screen name="planning" options={{ href: null }} />
      <Tabs.Screen name="prep-queue" options={{ href: null }} />
      <Tabs.Screen name="thermal" options={{ href: null }} />
      <Tabs.Screen name="chill" options={{ href: null }} />
      <Tabs.Screen name="qa-review" options={{ href: null }} />
      <Tabs.Screen name="packaging" options={{ href: null }} />
      <Tabs.Screen name="chiller-load" options={{ href: null }} />
    </Tabs>
  );
}
