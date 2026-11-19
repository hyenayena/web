import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {afterEach, beforeEach, test} from 'node:test';
import {noopLog} from '../src/log.js';
import {registerRoute, resetWebForTests, webStatus} from '../src/registry.js';
import {createServerControl, type ServerControl} from '../src/server.js';

let control: ServerControl | undefined;
const blockers: net.Server[] = [];

async function freePort(): Promise<number> {
	const s = net.createServer();
	await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
	const port = (s.address() as net.AddressInfo).port;
	await new Promise<void>(r => s.close(() => r()));
	return port;
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
	const end = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > end) throw new Error('timeout');
		await new Promise(r => setTimeout(r, 10));
	}
};

function call(port: number, opts: {method?: string; path: string; body?: string; headers?: Record<string, string>}): Promise<{status: number; body: string; headers: http.IncomingHttpHeaders}> {
	return new Promise((resolve, reject) => {
		const req = http.request({host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers, agent: false}, res => {
			const chunks: Buffer[] = [];
			res.on('data', c => chunks.push(c));
			res.on('end', () => resolve({status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers}));
		});
		req.on('error', reject);
		req.end(opts.body);
	});
}

beforeEach(() => {
	resetWebForTests();
	registerRoute({
		module: 'demo',
		endpoint: 'echo',
		methods: ['GET', 'POST'],
		maxBodyBytes: 100,
		handle: req => ({status: 200, type: 'text/plain; charset=utf-8', body: `${req.method}:${new TextDecoder().decode(req.body)}:${req.query.q ?? ''}`}),
	});
});

afterEach(async () => {
	control?.stop();
	control = undefined;
	for (const b of blockers.splice(0)) await new Promise<void>(r => b.close(() => r()));
});

const startOn = async (retryMs?: number): Promise<number> => {
	const port = await freePort();
	control = createServerControl({port, bind: '127.0.0.1', log: noopLog, ...(retryMs !== undefined && {retryMs})});
	control.start();
	await until(() => webStatus().state === 'running');
	return port;
};

test('a GET reaches the route with security headers', async () => {
	const port = await startOn();
	assert.equal(webStatus().baseUrl, `http://127.0.0.1:${port}`);
	const r = await call(port, {path: '/demo/echo?q=hi'});
	assert.equal(r.status, 200);
	assert.equal(r.body, 'GET::hi');
	assert.equal(r.headers['x-content-type-options'], 'nosniff');
	assert.equal(r.headers['cache-control'], 'no-store');
	assert.equal((await call(port, {path: '/nope'})).status, 404);
	assert.equal((await call(port, {path: '/demo/../x'})).status, 400);
	assert.equal((await call(port, {method: 'OPTIONS', path: '/demo/echo'})).status, 405);
});

test('a POST body within the cap is delivered', async () => {
	const port = await startOn();
	const r = await call(port, {method: 'POST', path: '/demo/echo', body: 'abc'});
	assert.equal(r.body, 'POST:abc:');
});

test('a body over the cap is 413 by content-length and when chunked', async () => {
	const port = await startOn();
	const big = 'x'.repeat(500);
	assert.equal((await call(port, {method: 'POST', path: '/demo/echo', body: big})).status, 413);
	const chunked = await new Promise<number>((resolve, reject) => {
		const req = http.request({host: '127.0.0.1', port, method: 'POST', path: '/demo/echo', agent: false, headers: {'Transfer-Encoding': 'chunked'}}, res => {
			res.resume();
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.write(big);
		req.end();
	});
	assert.equal(chunked, 413);
});

test('a busy port is reported and the server takes it when released', async () => {
	const port = await freePort();
	const blocker = net.createServer();
	await new Promise<void>(r => blocker.listen(port, '127.0.0.1', r));
	blockers.push(blocker);
	control = createServerControl({port, bind: '127.0.0.1', log: noopLog, retryMs: 50});
	control.start();
	control.start();
	await until(() => webStatus().state === 'busy');
	await new Promise<void>(r => blocker.close(() => r()));
	await until(() => webStatus().state === 'running');
	assert.equal((await call(port, {path: '/demo/echo'})).status, 200);
});

test('stop closes the server and start never throws', async () => {
	const port = await startOn();
	control!.stop();
	assert.equal(webStatus().state, 'stopped');
	await assert.rejects(call(port, {path: '/demo/echo'}));
	const bad = createServerControl({port: -5, bind: '127.0.0.1', log: noopLog});
	assert.doesNotThrow(() => bad.start());
	await until(() => webStatus().state === 'failed');
	bad.stop();
});

test('a chunked body over the route cap is 413 and the handler is never called', async () => {
	let called = 0;
	registerRoute({module: 'demo', endpoint: 'small', methods: ['POST'], maxBodyBytes: 10, handle: () => (called++, {status: 200})});
	const port = await startOn();
	const status = await new Promise<number>((resolve, reject) => {
		const req = http.request({host: '127.0.0.1', port, method: 'POST', path: '/demo/small', agent: false, headers: {'Transfer-Encoding': 'chunked'}}, res => {
			res.resume();
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.write('x'.repeat(8));
		req.write('y'.repeat(8));
		req.end();
	});
	assert.equal(status, 413);
	assert.equal(called, 0);
});

test('a GET to a route whose handler would throw gives a plain 500', async () => {
	registerRoute({module: 'demo', endpoint: 'boom', methods: ['GET'], handle: () => {
		throw new Error('secret detail');
	}});
	const port = await startOn();
	const r = await call(port, {path: '/demo/boom'});
	assert.equal(r.status, 500);
	assert.equal(r.body.includes('secret'), false);
});

test('a refused request never reaches the handler or reads the body', async () => {
	let called = 0;
	registerRoute({module: 'demo', endpoint: 'once', methods: ['POST'], handle: () => (called++, {status: 200})});
	const port = await startOn();
	assert.equal((await call(port, {method: 'POST', path: '/demo/once/%2e%2e%2f', body: 'a'})).status, 400);
	assert.equal((await call(port, {method: 'PUT', path: '/demo/once', body: 'a'})).status, 405);
	assert.equal((await call(port, {method: 'GET', path: '/demo/once'})).status, 405);
	assert.equal(called, 0);
});
