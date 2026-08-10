export type C3SEnvironment = 'development' | 'staging' | 'production';

export type EnvironmentBinding = {
  environment: C3SEnvironment;
  firebaseProjectId: string;
  stagingProjectId: string;
  productionProjectId: string;
};

export function normalizeEnvironment(value: string | undefined): C3SEnvironment | null {
  const normalized = (value ?? 'development').trim().toLowerCase();
  return normalized === 'development' || normalized === 'staging' || normalized === 'production'
    ? normalized
    : null;
}

export function validateEnvironmentBinding(binding: EnvironmentBinding): string[] {
  const errors: string[] = [];
  const projectId = binding.firebaseProjectId.trim();
  const stagingId = binding.stagingProjectId.trim();
  const productionId = binding.productionProjectId.trim();

  if (!projectId) errors.push('Firebase project ID is missing.');

  if (binding.environment === 'staging') {
    if (!stagingId) errors.push('The explicit staging Firebase project ID is missing.');
    if (!productionId) errors.push('The explicit production Firebase project ID is missing.');
    if (stagingId && projectId !== stagingId) {
      errors.push('The configured Firebase project does not match the explicit staging project.');
    }
    if (projectId && productionId && projectId === productionId) {
      errors.push('A staging build cannot target the production Firebase project.');
    }
    if (stagingId && productionId && stagingId === productionId) {
      errors.push('Staging and production Firebase project IDs must be different.');
    }
  }

  if (binding.environment === 'production') {
    if (!productionId) errors.push('The explicit production Firebase project ID is missing.');
    if (productionId && projectId !== productionId) {
      errors.push('The configured Firebase project does not match the explicit production project.');
    }
    if (projectId && stagingId && projectId === stagingId) {
      errors.push('A production build cannot target the staging Firebase project.');
    }
  }

  return errors;
}
