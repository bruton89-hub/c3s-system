/**
 * Sign-in screen — shown when Firebase anonymous sign-in is disabled or fails.
 * Uses Email/Password authentication (Firebase Auth provider must be enabled).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { C3S_COLORS, C3S_RADIUS } from '@/constants/c3s-ui';
import { C3SLogo } from '@/components/c3s-brand';
import { useAuth } from '@/lib/auth/context';
import { isStagingEnvironment } from '@/lib/environment';

// ─────────────────────────────────────────────────────────────────────────────

function parseAuthError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
    return 'Incorrect email or password.';
  }
  if (msg.includes('too-many-requests')) {
    return 'Too many sign-in attempts — try again later.';
  }
  if (msg.includes('network') || msg.includes('offline')) {
    return 'Network error — check your connection and try again.';
  }
  if (msg.includes('user-disabled')) {
    return 'This account has been disabled. Contact your supervisor.';
  }
  return 'Sign-in failed. Check your credentials and try again.';
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SignInScreen() {
  const { signInWithEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(trimmedEmail, password);
      // Navigation to tabs happens automatically via the auth gate in _layout.tsx.
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.headerBlock}>
          <C3SLogo />
          {isStagingEnvironment ? <Text style={styles.stagingLabel}>C3S STAGING</Text> : null}
          <Text style={styles.title}>Production Flow System</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        {/* Error banner */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Email */}
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@c3ssystems.com"
            placeholderTextColor={C3S_COLORS.textMuted}
            editable={!loading}
            returnKeyType="next"
          />
        </View>

        {/* Password */}
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            placeholder="••••••••"
            placeholderTextColor={C3S_COLORS.textMuted}
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
          />
        </View>

        {/* Sign In button */}
        <Pressable
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleSignIn}
          disabled={loading}
          accessibilityLabel="Sign in"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Sign In</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>
          Contact your supervisor if you don&apos;t have credentials.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C3S_COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: C3S_RADIUS.card,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    padding: 32,
    gap: 12,
  },
  stagingLabel: {
    alignSelf: 'center',
    color: C3S_COLORS.warning,
    backgroundColor: C3S_COLORS.warningSoft,
    borderColor: C3S_COLORS.warning,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: C3S_COLORS.textStrong,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  errorText: {
    color: C3S_COLORS.danger,
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  fieldBlock: {
    gap: 4,
  },
  label: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: '#FFFFFF',
    color: C3S_COLORS.textPrimary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  btn: {
    backgroundColor: C3S_COLORS.accent,
    borderRadius: C3S_RADIUS.button,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  hint: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
});
