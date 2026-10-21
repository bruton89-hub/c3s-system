import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, '.test-build');
rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync(resolve(root, 'node_modules/.bin/tsc'), [
  'tests/alert-hold-core.test.ts',
  'tests/reload-planning.test.ts',
  'lib/alerts/core.ts',
  'lib/holds/core.ts',
  'lib/operations/core.ts',
  'lib/stress/harness.ts',
  'lib/delays/core.ts',
  'lib/handoff-notes/core.ts',
  'lib/environment-core.ts',
  '--outDir', '.test-build',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--strict',
], { cwd: root, stdio: 'inherit' });

if (compile.status !== 0) process.exit(compile.status ?? 1);
const tests = spawnSync(process.execPath, ['--test', '.test-build/tests/alert-hold-core.test.js', '.test-build/tests/reload-planning.test.js'], { cwd: root, stdio: 'inherit' });
rmSync(outDir, { recursive: true, force: true });
process.exit(tests.status ?? 1);
