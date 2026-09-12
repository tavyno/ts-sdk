import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const consumer = mkdtempSync(join(tmpdir(), 'tavyno-consumer-'));
const run = (command, args, cwd = consumer) => execFileSync(command, args, { cwd, stdio: 'pipe' });

try {
    const packed = JSON.parse(
        run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], root),
    );
    assert.deepEqual(packed[0].files.map((file) => file.path).sort(), [
        'README.md',
        'THIRD_PARTY_NOTICES',
        'dist/calendar.d.ts',
        'dist/index.d.ts',
        'dist/index.js',
        'dist/oauth.d.ts',
        'dist/schedule-contracts.d.ts',
        'dist/schedule-responses.d.ts',
        'dist/schedule.d.ts',
        'dist/transport.d.ts',
        'package.json',
    ]);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    run('npm', ['install', '--ignore-scripts', '--no-audit', join(consumer, packed[0].filename)]);
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@tavyno/ts-sdk/package.json')));
    assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
    writeFileSync(
        join(consumer, 'consumer.ts'),
        `
import { createApiClient, type ApiClient, type HealthCheckResult, type TavynoEvent, type EventOccurrence, type EventGroupDetail } from '@tavyno/ts-sdk';
const client: ApiClient = createApiClient('https://example.com');
createApiClient('https://example.com', { getAccessToken: async () => 'token' });
// @ts-expect-error Raw tokens are not accepted because they become stale after refresh.
createApiClient('https://example.com', { jwt: 'token' });
const result: HealthCheckResult = await client.healthCheck();

if (result.status === 200) {
    const healthy: 'ok' = result.data.db;
    void healthy;
} else {
    const unhealthy: 'error' = result.data.db;
    void unhealthy;
}

const schedule = await client.events({ start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' });
const events: TavynoEvent[] = schedule.events;
const occurrences: EventOccurrence[] = schedule.occurrences;
const detail: EventGroupDetail = await client.eventGroup('group', { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' });
void [events, occurrences, detail];
await client.updateEvent('event', { title: 'Moved' }, { scope: 'occurrence', occurrenceId: 'occurrence' });
// @ts-expect-error A single-occurrence edit requires its canonical identifier.
client.updateEvent('event', { title: 'Moved' }, { scope: 'occurrence' });
// @ts-expect-error Ownership cannot be chosen by the host.
client.createCalendar({ name: 'Calendar', timeZone: 'UTC', userId: 'other-user' });
// @ts-expect-error Membership references an Event, never a provider or occurrence ID field.
client.addEventGroupMember('group', { occurrenceId: 'occurrence' });

// @ts-expect-error No arbitrary user-listing API is exposed.
client.users();
`,
    );
    for (const [name, module, moduleResolution] of [
        ['next', 'ESNext', 'Bundler'],
        ['expo', 'Preserve', 'Bundler'],
        ['node', 'NodeNext', 'NodeNext'],
    ]) {
        writeFileSync(
            join(consumer, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    strict: true,
                    noEmit: true,
                    skipLibCheck: false,
                    types: [],
                    target: 'ES2022',
                    lib: ['ES2022', 'DOM'],
                    module,
                    moduleResolution,
                    customConditions: name === 'expo' ? ['react-native'] : [],
                },
                files: ['consumer.ts'],
            }),
        );
        run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json']);
        run(join(root, 'node_modules/.bin/esbuild'), [
            'consumer.ts',
            '--bundle',
            '--format=esm',
            '--platform=browser',
            `--conditions=${name === 'expo' ? 'react-native' : 'browser'}`,
            `--outfile=${name}.js`,
        ]);
    }

    run('node', [
        '--input-type=module',
        '-e',
        `
import assert from 'node:assert/strict';
import { createApiClient } from '@tavyno/ts-sdk';
const result = await createApiClient('https://example.com', {
    fetcher: async () => Response.json({ status: 'ok', db: 'ok' }),
}).healthCheck();

assert.equal(result.data.db, 'ok');
const schedule = await createApiClient('https://example.com', {
    fetcher: async () => Response.json({ events: [], occurrences: [] }),
}).events({ start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' });
assert.deepEqual(schedule, { events: [], occurrences: [] });
`,
    ]);
    process.stdout.write(
        'Packed package: isolated install, ESM runtime, Next/Expo/Node types and browser/mobile bundles passed.\n',
    );
} finally {
    rmSync(consumer, { recursive: true, force: true });
}
