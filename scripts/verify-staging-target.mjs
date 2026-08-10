import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  console.error(`STAGING PREFLIGHT FAILED: ${message}`);
  process.exitCode = 1;
}

const root = resolve(import.meta.dirname, '..');
const requestedProject = (process.argv[2] ?? process.env.C3S_STAGING_FIREBASE_PROJECT_ID ?? '').trim();
const declaredStaging = (process.env.C3S_STAGING_FIREBASE_PROJECT_ID ?? '').trim();
const declaredProduction = (process.env.C3S_PRODUCTION_FIREBASE_PROJECT_ID ?? '').trim();

if (!requestedProject) fail('Pass the exact staging project ID as the first argument.');
if (!declaredStaging) fail('C3S_STAGING_FIREBASE_PROJECT_ID is not set.');
if (!declaredProduction) fail('C3S_PRODUCTION_FIREBASE_PROJECT_ID is not set.');
if (requestedProject && declaredStaging && requestedProject !== declaredStaging) {
  fail('The requested project does not match C3S_STAGING_FIREBASE_PROJECT_ID.');
}
if (requestedProject && declaredProduction && requestedProject === declaredProduction) {
  fail('The requested project is the declared production project.');
}
if (declaredStaging && declaredProduction && declaredStaging === declaredProduction) {
  fail('Staging and production project IDs are identical.');
}

let aliases;
try {
  aliases = JSON.parse(readFileSync(resolve(root, '.firebaserc'), 'utf8')).projects ?? {};
} catch {
  fail('.firebaserc is missing or invalid.');
}

if (aliases && aliases.staging !== declaredStaging) {
  fail('The .firebaserc staging alias does not match C3S_STAGING_FIREBASE_PROJECT_ID.');
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    environment: 'staging',
    projectId: requestedProject,
    alias: 'staging',
  }, null, 2));
}
