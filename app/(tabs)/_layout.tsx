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
      {/* 1 — Plant Flow overview */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Plant Flow',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gauge.with.dots.needle.50percent" color={color} />,
        }}
      />

      {/* 2 — RTC / Prep Queue (blue theme) */}
      <Tabs.Screen
        name="prep-queue"
        options={{
          title: 'RTC Queue',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="list.bullet.rectangle.portrait.fill" color={color} />,
        }}
      />

      {/* 3 — Thermal / Cook Operations (flame icon, orange/red theme) */}
      <Tabs.Screen
        name="thermal"
        options={{
          title: 'Thermal',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="flame.fill" color={color} />,
        }}
      />

      {/* 4 — Chill Operations (snowflake icon, light blue theme) */}
      <Tabs.Screen
        name="chill"
        options={{
          title: 'Chill',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="snowflake" color={color} />,
        }}
      />

      {/* 5 — Packaging */}
      <Tabs.Screen
        name="qa-review"
        options={{
          title: 'QA Review',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="checkmark.seal.fill" color={color} />,
        }}
      />

      {/* 6 — Packaging */}
      <Tabs.Screen
        name="packaging"
        options={{
          title: 'Packaging',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="shippingbox.fill" color={color} />,
        }}
      />

      {/* 7 — Planning (manager/planner tool — last tab) */}
      <Tabs.Screen
        name="planning"
        options={{
          title: 'Planning',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar.badge.clock" color={color} />,
        }}
      />

      {/* Hidden screens — not shown in tab bar */}
      <Tabs.Screen
        name="chiller-load"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ href: null }}
      />
    </Tabs>
  );
}
