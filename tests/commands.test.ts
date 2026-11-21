import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {createWebCommand} from '../src/commands.js';
import {noopLog} from '../src/log.js';
import {registerRoute, resetWebForTests, setWebStatus, webStatus} from '../src/registry.js';
import type {ServerControl} from '../src/server.js';

const fake = () => {
	const calls = {start: 0, stop: 0};
	const control: ServerControl = {start: () => void calls.start++, stop: () => void calls.stop++, status: webStatus};
	return {calls, control};
};

const ctx = (extra: Record<string, unknown> = {}) => {
	const out: string[] = [];
	let help = 0;
	return {
		out,
		helps: () => help,
		value: {
			print: (t: string) => out.push(t),
			printStyled: (blocks: unknown[]) => out.push(JSON.stringify(blocks)),
			showHelp: () => help++,
			...extra,
		} as never,
	};
};

beforeEach(() => resetWebForTests());

test('metadata and policies', () => {
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	assert.equal(cmd.name, 'web');
	assert.equal(cmd.autostart, true);
	assert.equal(cmd.agent, 'safe');
	assert.deepEqual(cmd.subcommands?.map(s => [s.name, s.agent]), [['status', 'safe']]);
});

test('the first run without arguments (autostart) starts the server silently', async () => {
	const f = fake();
	const cmd = createWebCommand({control: f.control, log: noopLog});
	const c = ctx({showHelp: undefined});
	await cmd.run([], c.value);
	assert.equal(f.calls.start, 1);
	assert.deepEqual(c.out, []);
});

test('a later run without arguments shows help, with a fallback', async () => {
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	await cmd.run([], ctx().value);
	const c = ctx();
	await cmd.run([], c.value);
	assert.equal(c.helps(), 1);
	const d = ctx({showHelp: undefined});
	await cmd.run([], d.value);
	assert.deepEqual(d.out, ['web <subcommand>']);
});

test('a headless run never starts the server', async () => {
	const f = fake();
	const cmd = createWebCommand({control: f.control, log: noopLog});
	const c = ctx({headless: true});
	await cmd.run(['status'], c.value);
	assert.equal(f.calls.start, 0);
	assert.match(c.out.join(''), /not running in this process/);
});

test('status shows each state', async () => {
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	const show = async () => {
		const c = ctx();
		await cmd.run(['status'], c.value);
		return c.out.join('');
	};
	setWebStatus({state: 'running', port: 8080, baseUrl: 'http://127.0.0.1:8080'});
	assert.match(await show(), /running.*http:\/\/127\.0\.0\.1:8080.*8080.*No module has registered a page/s);
	setWebStatus({state: 'starting', port: 8080});
	assert.match(await show(), /starting/);
	setWebStatus({state: 'busy', port: 8080});
	assert.match(await show(), /port 8080 is busy.*retrying every 30 s/);
	setWebStatus({state: 'failed', port: 8080, error: 'EACCES'});
	assert.match(await show(), /failed: EACCES/);
	setWebStatus({state: 'stopped'});
	assert.match(await show(), /not running in this process/);
});

test('status lists the routes', async () => {
	registerRoute({module: 'demo', endpoint: 'graph', methods: ['GET', 'POST'], prefix: true, handle: () => ({status: 200})});
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	const c = ctx();
	await cmd.run(['status'], c.value);
	assert.match(c.out.join(''), /\/demo\/graph\/…/);
	assert.match(c.out.join(''), /GET, POST/);
});

test('usage errors carry the usage kind', async () => {
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	await assert.rejects(async () => cmd.run(['status', 'x'], ctx().value), (e: Error & {kind?: string}) => e.kind === 'usage');
	await assert.rejects(async () => cmd.run(['nope'], ctx().value), (e: Error & {kind?: string}) => e.kind === 'usage' && /Unknown subcommand: nope/.test(e.message));
});

test('a busy status in headless mode still reports not running', async () => {
	setWebStatus({state: 'busy', port: 8080});
	const c = ctx({headless: true});
	await createWebCommand({control: fake().control, log: noopLog}).run(['status'], c.value);
	assert.match(c.out.join(''), /not running in this process/);
	assert.doesNotMatch(c.out.join(''), /busy/);
});

test('status refuses extra words', async () => {
	const cmd = createWebCommand({control: fake().control, log: noopLog});
	await assert.rejects(async () => cmd.run(['status', 'x'], ctx().value), (e: Error & {kind?: string}) => e.kind === 'usage');
});
