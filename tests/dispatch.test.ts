import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {finalHeaders, invokeRoute, resolveRequest, FIXED_HEADERS} from '../src/dispatch.js';
import {noopLog} from '../src/log.js';
import {registerRoute, resetWebForTests} from '../src/registry.js';
import type {WebRoute} from '../src/types.js';

const handle = () => ({status: 200, body: 'ok'});
const get = (url: string, method = 'GET', gate?: Parameters<typeof resolveRequest>[1]) => resolveRequest({method, url, headers: {Host: 'x', 'X-A': ['1', '2']}}, gate);

beforeEach(() => {
	resetWebForTests();
	registerRoute({module: 'demo', endpoint: 'page', methods: ['GET', 'POST'], prefix: true, handle});
});

const status = (r: ReturnType<typeof get>) => (r.ok ? 0 : r.response.status);

test('a routed request resolves with rest, query and lower-case headers', () => {
	const r = get('/demo/page/a/b?x=1&x=2&y=%20z');
	assert.ok(r.ok);
	assert.deepEqual(r.request.rest, ['a', 'b']);
	assert.deepEqual({...r.request.query}, {x: '1', y: ' z'});
	assert.equal(r.request.headers['x-a'], '1, 2');
	assert.equal(r.maxBody, 0);
	const post = get('/demo/page', 'POST');
	assert.ok(post.ok);
	assert.equal(post.maxBody, 64 * 1024);
});

test('traversal and bad escapes are 400', () => {
	for (const u of ['/demo/../page', '/demo/%2e%2e/page', '/demo/page/%2e', '/demo%2Fpage', '/demo/page%5Cx', '/demo/page%00', '/demo/page/%zz', '/demo//page', '/demo/page/a\\b', '/demo/page/%01', '/demo/pa\nge']) {
		assert.equal(status(get(u)), 400, u);
	}
	assert.equal(status(get('demo/page')), 400);
	assert.equal(status(get('*')), 400);
});

test('too long is 414', () => {
	assert.equal(status(get('/demo/' + 'a'.repeat(2050))), 414);
});

test('no route is 404 without a listing', () => {
	const r = get('/nothing');
	assert.ok(!r.ok);
	assert.equal(r.response.status, 404);
	assert.equal(r.response.body, 'Not found');
	assert.equal(status(get('/')), 404);
});

test('other methods are 405 with Allow and no CORS headers', () => {
	for (const m of ['OPTIONS', 'PUT', 'DELETE', 'HEAD']) {
		const r = get('/demo/page', m);
		assert.ok(!r.ok);
		assert.equal(r.response.status, 405);
		assert.equal(r.response.headers?.Allow, 'GET, POST');
		assert.equal(Object.keys(r.response.headers ?? {}).some(k => k.toLowerCase().startsWith('access-control')), false);
	}
	registerRoute({module: 'demo', endpoint: 'readonly', methods: ['GET'], handle});
	const r = get('/demo/readonly', 'POST');
	assert.ok(!r.ok);
	assert.equal(r.response.status, 405);
	assert.equal(r.response.headers?.Allow, 'GET');
});

test('the gate is called for every routed request and can refuse', () => {
	const seen: string[] = [];
	get('/demo/page/x', 'GET', req => (seen.push(`${req.method} ${req.module}/${req.endpoint}`), undefined));
	get('/demo/page', 'POST', req => (seen.push(`${req.method} ${req.module}/${req.endpoint}`), undefined));
	get('/nothing', 'GET', () => (seen.push('unrouted'), undefined));
	assert.deepEqual(seen, ['GET demo/page', 'POST demo/page']);
	const refused = get('/demo/page', 'GET', () => ({status: 401, body: 'no'}));
	assert.ok(!refused.ok);
	assert.equal(refused.response.status, 401);
});

test('more than 32 query keys is 400', () => {
	const q = Array.from({length: 33}, (_, i) => `k${i}=1`).join('&');
	assert.equal(status(get(`/demo/page?${q}`)), 400);
	assert.equal(status(get(`/demo/page?${q.split('&').slice(0, 32).join('&')}`)), 0);
});

const route = (h: WebRoute['handle']): WebRoute => ({module: 'demo', endpoint: 'p', methods: ['GET'], handle: h});
const req = {method: 'GET' as const, module: 'demo', endpoint: 'p', rest: [], query: {}, headers: {}, body: new Uint8Array(0)};

test('a throwing handler is 500 without leaking the error', async () => {
	const warns: unknown[] = [];
	const log = {...noopLog, warn: (m: string, meta: unknown) => warns.push([m, meta])};
	const r = await invokeRoute(route(() => { throw new Error('secret detail'); }), req, log);
	assert.equal(r.status, 500);
	assert.equal(r.body, 'Internal error');
	assert.equal(warns.length, 1);
	const rejected = await invokeRoute(route(async () => { throw new Error('secret detail'); }), req, noopLog);
	assert.equal(rejected.body, 'Internal error');
});

test('an invalid response is 500', async () => {
	for (const bad of [{status: 99}, {status: 600}, {status: 200.5}, {status: '200'}, {status: 200, type: 'a\r\nb'}, {status: 200, body: 5}, null]) {
		const r = await invokeRoute(route(() => bad as never), req, noopLog);
		assert.equal(r.status, 500, JSON.stringify(bad));
	}
	assert.equal((await invokeRoute(route(() => ({status: 204})), req, noopLog)).status, 204);
});

test('the fixed security headers are always present and win', () => {
	const h = finalHeaders({status: 200, headers: {'x-frame-options': 'ALLOWALL', 'Cache-Control': 'public', 'X-Own': 'yes'}});
	for (const [k, v] of Object.entries(FIXED_HEADERS)) assert.equal(h[k], v, k);
	assert.equal(Object.keys(h).filter(k => k.toLowerCase() === 'x-frame-options').length, 1);
	assert.equal(h['X-Own'], 'yes');
	assert.equal(h['Content-Type'], 'text/plain; charset=utf-8');
	assert.equal(finalHeaders({status: 200, type: 'text/html; charset=utf-8'})['Content-Type'], 'text/html; charset=utf-8');
});

test('Access-Control headers and unsafe handler headers are dropped', () => {
	const h = finalHeaders({
		status: 200,
		headers: {'Access-Control-Allow-Origin': '*', 'access-control-allow-credentials': 'true', 'Bad Name': 'x', 'X-Split': 'a\r\nSet-Cookie: b', 'Content-Length': '1', 'Transfer-Encoding': 'chunked', 'X-Ok': 'fine'},
	});
	assert.deepEqual(Object.keys(h).filter(k => /access-control|bad|split|length|transfer/i.test(k)), []);
	assert.equal(h['X-Ok'], 'fine');
});

test('percent escapes are decoded once: a double-encoded dot stays literal', () => {
	const r = get('/demo/page/%252e%252e');
	assert.ok(r.ok);
	assert.deepEqual(r.request.rest, ['%2e%2e']);
	assert.equal(status(get('/demo/page/%2E%2E')), 400);
	assert.equal(status(get('/demo/page/%252F')), 0);
});

test('the gate runs before any body exists and gets no body', () => {
	let seen: Record<string, unknown> | undefined;
	const r = get('/demo/page', 'POST', req => ((seen = req as never), undefined));
	assert.ok(r.ok);
	assert.equal('body' in seen!, false);
	assert.equal(seen!.method, 'POST');
});

test('a gate is not called for requests that fail before routing', () => {
	let calls = 0;
	const gate = () => (calls++, undefined);
	get('/demo/../page', 'GET', gate);
	get('/nothing', 'GET', gate);
	get('/demo/page', 'PUT', gate);
	assert.equal(calls, 0);
});
