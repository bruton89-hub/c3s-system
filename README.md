# C3S Preview

C3S Preview is an Expo/React Native operations prototype for tracking plant-floor product movement from RTC through thermal processing, chilling, QA review, and packaging. It is designed as a command-center style workflow app for validating production handoffs, queue state, alerts, and planning data before a full production backend rollout.

## Tech Stack

- Expo SDK 54 with Expo Router
- React Native 0.81 and React 19
- TypeScript
- Firebase Web SDK for Auth and Firestore
- Firebase Admin SDK for local maintenance/seed scripts
- ESLint with Expo config

## Features

- Plant-flow dashboard for operational status across production stages
- RTC prep queue and thermal assignment workflow
- Chiller load, chill log, and thermal timeline screens
- QA review and packaging operations views
- Product profile and planning data helpers
- Firebase-backed repositories and typed Firestore collection helpers
- Local seed/check scripts for development data

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local environment file:

   ```sh
   cp .env.example .env
   ```

3. Fill `.env` with Firebase Web SDK values from your own Firebase project.

4. Start the app:

   ```sh
   npm start
   ```

5. Run on a target platform:

   ```sh
   npm run ios
   npm run android
   npm run web
   ```

## Environment Variables

Runtime Firebase config is read from `EXPO_PUBLIC_FIREBASE_*` variables and mapped through `app.config.js` into `Constants.expoConfig.extra.firebase`.

Required runtime variables:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Local Node scripts can also use the non-Expo fallback names in `.env.example`.

For Firebase Admin scripts, prefer `GOOGLE_APPLICATION_CREDENTIALS` pointing to a local service account JSON file outside the repo or ignored by Git. Do not commit service account JSON, private keys, `.env`, `.firebaserc`, native signing files, or Google/Firebase platform config files that contain real project identifiers.

## Firebase

Tracked Firebase files:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`

Local Firebase project selection should be configured outside the public repository. If needed, create a local `.firebaserc` after cloning:

```sh
firebase use --add
```

## Development Scripts

```sh
npm run lint
npx tsc --noEmit
npm run seed:dev
npm run seed:products
npm run seed:product-profiles
npm run check:data-state
npm run normalize:legacy
```

The seed and maintenance scripts require valid Firebase configuration and may write to the configured Firestore project.

## Build and Deployment

Local web export:

```sh
npx expo export --platform web
```

EAS build:

```sh
eas build --platform ios --profile preview
eas build --platform ios --profile production
```

Firebase rules/index deployment:

```sh
firebase deploy --only firestore:rules,firestore:indexes
```

Before running EAS or Firebase deployment commands, configure local project/account state with the relevant CLIs. Do not commit generated project metadata or credentials.

## Screenshots

Add release screenshots here before publishing the repository.

Suggested captures:

- Plant-flow dashboard
- Prep queue
- Thermal timeline
- QA review
- Packaging operations

## Public Repo Checklist

- `.env` is present only locally and ignored by Git.
- `.env.example` contains placeholders only.
- `.firebaserc` is local-only and not tracked.
- EAS project/account identifiers are not committed in `app.json`.
- Service account JSON files, private keys, signing credentials, and platform config files are not tracked.
- `node_modules/`, `.expo/`, `dist/`, native build folders, caches, and OS/editor files are ignored.
- `npm run lint` passes.
- `npx tsc --noEmit` passes.
- Git history has been checked for previously tracked secrets or generated files.
- If history is unsafe, publish from a fresh orphan branch instead of pushing existing history.
