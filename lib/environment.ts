import Constants from 'expo-constants';

import { normalizeEnvironment, validateEnvironmentBinding, type C3SEnvironment } from '@/lib/environment-core';

type EnvironmentExtra = {
  appEnvironment?: string;
  stagingProjectId?: string;
  productionProjectId?: string;
};

const environmentExtra = (Constants.expoConfig?.extra as Record<string, unknown> | null | undefined)
  ?.environmentBinding as EnvironmentExtra | null | undefined;
const configuredEnvironment = environmentExtra?.appEnvironment || process.env.EXPO_PUBLIC_APP_ENV;
const normalizedEnvironment = normalizeEnvironment(configuredEnvironment);

export const appEnvironment: C3SEnvironment = normalizedEnvironment ?? 'development';
export const environmentNameIsValid = normalizedEnvironment !== null;
export const isStagingEnvironment = appEnvironment === 'staging';

export function getRuntimeEnvironmentErrors(firebaseProjectId: string): string[] {
  const errors = environmentNameIsValid
    ? []
    : ['EXPO_PUBLIC_APP_ENV must be development, staging, or production.'];

  return errors.concat(validateEnvironmentBinding({
    environment: appEnvironment,
    firebaseProjectId,
    stagingProjectId: environmentExtra?.stagingProjectId || process.env.EXPO_PUBLIC_STAGING_FIREBASE_PROJECT_ID || '',
    productionProjectId: environmentExtra?.productionProjectId || process.env.EXPO_PUBLIC_PRODUCTION_FIREBASE_PROJECT_ID || '',
  }));
}
