import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { C3SProvider } from '@/store/c3s-store';
import { AuthProvider, useAuth } from '@/lib/auth/context';
import { C3S_COLORS } from '@/constants/c3s-ui';

export const unstable_settings = {
  anchor: '(tabs)',
};

// ── Auth gate ────────────────────────────────────────────────────────────────
// Watches auth state and redirects between sign-in and the main tabs.
// Must live inside AuthProvider AND inside the Stack so useSegments() works.

function useAuthRedirect() {
  const { status } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (status === 'loading') return;

    const inSignIn = segments[0] === 'sign-in';

    if (status === 'signed-out' && !inSignIn) {
      router.replace('/sign-in');
    } else if (status === 'signed-in' && inSignIn) {
      router.replace('/(tabs)');
    }
  }, [status, segments]);
}

// ─────────────────────────────────────────────────────────────────────────────

function RootLayoutNav() {
  const { status, startupError } = useAuth();
  const colorScheme = useColorScheme();
  useAuthRedirect();

  // Show a full-screen spinner while Firebase resolves the initial auth state
  // (includes the automatic anonymous sign-in attempt).
  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C3S_COLORS.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={C3S_COLORS.accent} size="large" />
      </View>
    );
  }

  if (status === 'startup-error') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C3S_COLORS.bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <View style={{ maxWidth: 520, borderWidth: 1, borderColor: C3S_COLORS.danger, padding: 16, borderRadius: 8 }}>
          <ActivityIndicator color={C3S_COLORS.danger} size="small" />
          <Text style={{ color: C3S_COLORS.textStrong, marginTop: 12, fontWeight: '700' }}>
            C3S startup error: Firebase configuration missing.
          </Text>
          <Text style={{ color: C3S_COLORS.textMuted, marginTop: 8 }}>
            {startupError ?? 'Missing EXPO_PUBLIC_FIREBASE_* environment values.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="batch-timeline" options={{ headerShown: false }} />
        <Stack.Screen name="qa-review" options={{ headerShown: false }} />
        <Stack.Screen name="thermal-timeline" options={{ headerShown: false }} />
        <Stack.Screen name="products/index" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <AuthProvider>
      <C3SProvider>
        <RootLayoutNav />
      </C3SProvider>
    </AuthProvider>
  );
}
