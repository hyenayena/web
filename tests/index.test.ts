import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import plugin from '../src/index.js';
import {resetWebForTests, webBaseUrl, webStatus} from '../src/registry.js';

const host = (log?: never) => ({dataDir: '/nonexistent', events: {emit() {}, on: () => () => {}}, log}) as never;

beforeEach(() => resetWebForTests());

test('registers the web command and listens on nothing at load', async () => {
	const commands = await plugin(host());
	assert.deepEqual(commands.map(c => c.name), ['web']);
	assert.equal(webStatus().state, 'stopped');
	assert.match(webBaseUrl(), /^http:\/\/127\.0\.0\.1(:\d+)?$/);
});

test('works without a host logger', async () => {
	await assert.doesNotReject(async () => plugin(host(undefined)));
});

test('a headless status never starts a listener', async () => {
	const [cmd] = await plugin(host());
	await cmd!.run(['status'], {print() {}, printStyled() {}, headless: true} as never);
	assert.equal(webStatus().state, 'stopped');
});
