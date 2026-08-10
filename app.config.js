// app.config.js — Dynamic Expo config (extends app.json)
//
// This file runs in a real Node.js environment during `expo prebuild` and
// `eas build` — BEFORE Metro bundles any JS. All process.env reads here
// are plain Node.js reads, so EAS production env vars are always present.
//
// Why this exists:
//   babel-preset-expo inlines process.env.EXPO_PUBLIC_* via a Babel AST
//   transform, which only runs when the transform cache is clean and the
//   correct preset version is installed. Relying on that path alone has
//   proven unreliable across EAS build cache states.
//
//   Mapping the values into `extra.firebase` here and reading them via
//   Constants.expoConfig.extra.firebase at runtime is 100% reliable because
//   expo-constants embeds the extra block directly into the native binary.
//
// Note: `config` is the merged result of app.json — we spread it and only
// override the `extra` block, so all other app.json values are preserved.

/** @param {{ config: import('@expo/config-types').ExpoConfig }} ctx */
module.exports = ({ config }) => {
  const appEnvironment = (process.env.EXPO_PUBLIC_APP_ENV ?? 'development').trim().toLowerCase();
  return {
    ...config,
    name: appEnvironment === 'staging' ? 'C3S STAGING' : config.name,
    extra: {
      ...config.extra,
      // Expo Router needs this preserved as-is:
      router: config.extra?.router ?? {},
      // EAS project ID must be preserved:
      eas: config.extra?.eas ?? {},
      // Firebase web SDK config — values are read from the EAS production
      // environment (or local .env for dev). Never hardcoded here.
      firebase: {
        apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY             ?? '',
        authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN         ?? '',
        projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID          ?? '',
        storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET      ?? '',
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID              ?? '',
      },
      environmentBinding: {
        appEnvironment,
        stagingProjectId: process.env.EXPO_PUBLIC_STAGING_FIREBASE_PROJECT_ID ?? '',
        productionProjectId: process.env.EXPO_PUBLIC_PRODUCTION_FIREBASE_PROJECT_ID ?? '',
      },
      useFirebaseEmulators: process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true',
      disableAnonymousAuth: process.env.EXPO_PUBLIC_DISABLE_ANONYMOUS_AUTH === 'true',
    },
  };
};
