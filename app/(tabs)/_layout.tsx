import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          height: 74,
          paddingTop: 6,
          paddingBottom: 10,
          backgroundColor: C3S_COLORS.panel,
          borderTopColor: C3S_COLORS.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Plant Flow',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gauge.with.dots.needle.50percent" color={color} />,
        }}
      />
      <Tabs.Screen
        name="planning"
        options={{
          title: 'Weekly Plan',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar.badge.clock" color={color} />,
        }}
      />
      <Tabs.Screen
        name="prep-queue"
        options={{
          title: 'RTC Queue',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="list.bullet.rectangle.portrait.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chiller-load"
        options={{
          title: 'Thermal',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="snowflake" color={color} />,
        }}
      />
      <Tabs.Screen
        name="packaging"
        options={{
          title: 'Packaging Operations',
          tabBarLabel: 'Packaging Ops',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="shippingbox.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bell.badge.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
