import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const consumer = mkdtempSync(join(tmpdir(), 'tavyno-consumer-'));
const run = (command, args, cwd = consumer) => execFileSync(command, args, { cwd, stdio: 'pipe' });
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], root));
  assert.deepEqual(packed[0].files.map(file => file.path).sort(), ['README.md', 'THIRD_PARTY_NOTICES', 'dist/calendar.d.ts', 'dist/index.d.ts', 'dist/index.js', 'dist/oauth.d.ts', 'package.json']);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--ignore-scripts', '--no-audit', join(consumer, packed[0].filename)]);
  const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@tavyno/api-client/package.json')));
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  writeFileSync(join(consumer, 'consumer.ts'), `
import { createApiClient, type ApiClient, type HealthCheckResult } from '@tavyno/api-client';
const client: ApiClient = createApiClient('https://example.com');
const result: HealthCheckResult = await client.healthCheck();
if (result.status === 200) { const healthy: 'ok' = result.data.db; void healthy; }
else { const unhealthy: 'error' = result.data.db; void unhealthy; }
// @ts-expect-error Only health is public.
client.users();
`);
  for (const [name, module, moduleResolution] of [['next', 'ESNext', 'Bundler'], ['expo', 'Preserve', 'Bundler'], ['node', 'NodeNext', 'NodeNext']]) {
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: false, types: [], target: 'ES2022',
      lib: ['ES2022', 'DOM'], module, moduleResolution,
      customConditions: name === 'expo' ? ['react-native'] : [],
    }, files: ['consumer.ts'] }));
    run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json']);
    run(join(root, 'node_modules/.bin/esbuild'), ['consumer.ts', '--bundle', '--format=esm', '--platform=browser', `--conditions=${name === 'expo' ? 'react-native' : 'browser'}`, `--outfile=${name}.js`]);
  }
  run('node', ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import { createApiClient } from '@tavyno/api-client';
const result = await createApiClient('https://example.com', {
  fetcher: async () => Response.json({ status: 'ok', db: 'ok' })
}).healthCheck();
assert.equal(result.data.db, 'ok');
`]);
  process.stdout.write('Packed package: isolated install, ESM runtime, Next/Expo/Node types and browser/mobile bundles passed.\n');
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
