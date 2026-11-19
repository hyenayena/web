import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {configureWeb, matchRoute, resetWebForTests, setWebStatus} from '../src/registry.js';
import {MAX_BODY_BYTES, registerRoute, webBaseUrl, webRoutes, webStatus} from '../src/public.js';

const handle = () => ({status: 200});
const route = (over: Record<string, unknown> = {}) => ({module: 'demo', endpoint: 'page', methods: ['GET'] as ('GET' | 'POST')[], handle, ...over}) as never;

beforeEach(() => resetWebForTests());

test('a valid route registers and lists sorted', () => {
	registerRoute(route({module: 'zed'}));
	registerRoute(route({prefix: true}));
	assert.deepEqual(webRoutes().map(r => [r.module, r.endpoint, r.prefix]), [['demo', 'page', true], ['zed', 'page', false]]);
});

test('invalid routes are refused', () => {
	const bad: Record<string, unknown>[] = [
		{module: 'Demo'},
		{module: '1x'},
		{module: ''},
		{endpoint: ''},
		{endpoint: 'a//b'},
		{endpoint: '..'},
		{endpoint: '.'},
		{endpoint: 'a/../b'},
		{endpoint: 'A'},
		{endpoint: 'a/b/c/d/e/f/g/h/i'},
		{endpoint: '/a'},
		{methods: []},
		{methods: ['PUT']},
		{methods: 'GET'},
		{maxBodyBytes: -1},
		{maxBodyBytes: 1.5},
		{maxBodyBytes: MAX_BODY_BYTES + 1},
		{handle: undefined},
	];
	for (const b of bad) assert.throws(() => registerRoute(route(b)), Error, JSON.stringify(b));
	assert.equal(webRoutes().length, 0);
});

test('a duplicate is refused and unregister is idempotent', () => {
	const off = registerRoute(route());
	assert.throws(() => registerRoute(route()), /Route \/demo\/page is already registered/);
	off();
	off();
	assert.equal(webRoutes().length, 0);
	const again = registerRoute(route());
	off();
	assert.equal(webRoutes().length, 1);
	again();
	assert.equal(webRoutes().length, 0);
});

test('at most 64 routes', () => {
	for (let i = 0; i < 64; i++) registerRoute(route({endpoint: `p${i}`}));
	assert.throws(() => registerRoute(route({endpoint: 'extra'})), /At most 64/);
});

test('the longest match wins and a prefix route keeps the rest', () => {
	registerRoute(route({endpoint: 'graph', prefix: true}));
	registerRoute(route({endpoint: 'graph/special'}));
	assert.equal(matchRoute(['demo', 'graph', 'special'])?.route.endpoint, 'graph/special');
	const deep = matchRoute(['demo', 'graph', 'abc', 'data']);
	assert.equal(deep?.route.endpoint, 'graph');
	assert.deepEqual(deep?.rest, ['abc', 'data']);
	assert.equal(matchRoute(['demo', 'graph', 'special', 'x'])?.route.endpoint, 'graph');
	assert.equal(matchRoute(['demo']), undefined);
	assert.equal(matchRoute([]), undefined);
	registerRoute(route({module: 'exact', endpoint: 'one'}));
	assert.equal(matchRoute(['exact', 'one', 'more']), undefined);
});

test('the status is stopped by default and a frozen copy', () => {
	assert.deepEqual(webStatus(), {state: 'stopped'});
	setWebStatus({state: 'running', port: 1234});
	const s = webStatus();
	assert.equal(Object.isFrozen(s), true);
	assert.equal(s.port, 1234);
});

test('webBaseUrl needs a configuration', () => {
	assert.throws(() => webBaseUrl(), /The web module is not loaded/);
	configureWeb({error: 'Invalid YENA_WEB_PORT (x)'});
	assert.throws(() => webBaseUrl(), /Invalid YENA_WEB_PORT/);
	configureWeb({port: 7301});
	assert.equal(webBaseUrl(), 'http://127.0.0.1:7301');
});
