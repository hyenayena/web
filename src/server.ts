import {createServer as nodeCreateServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {Logger} from '../../../src/api.js';
import {encodeBody, finalHeaders, invokeRoute, resolveRequest} from './dispatch.js';
import {originFor} from './config.js';
import {setWebStatus, webStatus} from './registry.js';
import type {WebResponse, WebStatus} from './types.js';

export type ServerControl = {start(): void; stop(): void; status(): WebStatus};

export type ServerOptions = {
	port: number;
	bind: string;
	log: Logger;
	retryMs?: number;
	createServer?: (listener: (req: IncomingMessage, res: ServerResponse) => void) => Server;
};

const RETRY_MS = 30_000;

const errorCode = (err: unknown): string => (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code! : err instanceof Error ? err.constructor.name : 'unknown');

function send(res: ServerResponse, resp: WebResponse, close: boolean): Promise<number> {
	const body = encodeBody(resp);
	const headers = finalHeaders(resp);
	headers['Content-Length'] = String(body.byteLength);
	if (close) headers.Connection = 'close';
	return new Promise(resolve => {
		res.once('close', () => resolve(body.byteLength));
		res.writeHead(resp.status, headers);
		res.end(body);
	});
}

function readBody(req: IncomingMessage, max: number): Promise<Uint8Array | 'too-large' | 'aborted'> {
	return new Promise(resolve => {
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const finish = (value: Uint8Array | 'too-large' | 'aborted'): void => {
			if (done) return;
			done = true;
			req.off('data', onData);
			resolve(value);
		};
		const onData = (chunk: Buffer): void => {
			size += chunk.byteLength;
			if (size > max) return finish('too-large');
			chunks.push(chunk);
		};
		req.on('data', onData);
		req.once('end', () => finish(Buffer.concat(chunks)));
		req.once('error', () => finish('aborted'));
		req.once('aborted', () => finish('aborted'));
	});
}

export function createServerControl(options: ServerOptions): ServerControl {
	const {port, bind, log} = options;
	const retryMs = options.retryMs ?? RETRY_MS;
	const make = options.createServer ?? (listener => nodeCreateServer({requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000}, listener));
	let server: Server | undefined;
	let timer: NodeJS.Timeout | undefined;
	let warnedBusy = false;

	const reject = async (req: IncomingMessage, res: ServerResponse, resp: WebResponse): Promise<number> => {
		const bytes = await send(res, resp, true);
		if (!req.complete) req.destroy();
		return bytes;
	};

	const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const started = Date.now();
		const resolved = resolveRequest({method: req.method ?? '', url: req.url ?? '', headers: req.headers});
		if (!resolved.ok) {
			await reject(req, res, resolved.response);
			return;
		}
		const {route, request, maxBody} = resolved;
		const declared = Number(req.headers['content-length'] ?? 0);
		if (declared > maxBody) {
			await reject(req, res, {status: 413, body: 'Payload too large'});
			return;
		}
		const body = await readBody(req, maxBody);
		if (body === 'aborted') return;
		if (body === 'too-large') {
			await reject(req, res, {status: 413, body: 'Payload too large'});
			return;
		}
		const resp = await invokeRoute(route, {...request, body}, log);
		const bytes = await send(res, resp, false);
		log.debug('web request', {module: route.module, endpoint: route.endpoint, method: request.method, status: resp.status, ms: Date.now() - started, bytes});
	};

	const set = (status: WebStatus): void => setWebStatus(status);

	const attempt = (): void => {
		timer = undefined;
		const current = make((req, res) => {
			handle(req, res).catch(err => {
				log.warn('web request failed', {err});
				if (!res.headersSent) res.writeHead(500).end();
				else res.destroy();
			});
		});
		server = current;
		current.maxConnections = 64;
		current.maxHeadersCount = 64;
		current.maxRequestsPerSocket = 100;
		current.on('error', (err: NodeJS.ErrnoException) => {
			if (server !== current) return;
			server = undefined;
			current.close();
			if (err.code === 'EADDRINUSE') {
				if (!warnedBusy) log.warn('web port busy', {port});
				warnedBusy = true;
				set({state: 'busy', port, since: Date.now()});
				timer = setTimeout(attempt, retryMs);
				timer.unref();
				return;
			}
			log.warn('web server failed', {code: errorCode(err)});
			set({state: 'failed', port, error: errorCode(err), since: Date.now()});
		});
		current.once('listening', () => {
			current.unref();
			warnedBusy = false;
			set({state: 'running', port, baseUrl: originFor(port), since: Date.now()});
			log.info('web server listening', {port});
		});
		try {
			current.listen({port, host: bind});
		} catch (err) {
			server = undefined;
			log.warn('web server failed', {code: errorCode(err)});
			set({state: 'failed', port, error: errorCode(err), since: Date.now()});
		}
	};

	return {
		start() {
			const state = webStatus().state;
			if (server || timer || state === 'starting' || state === 'running' || state === 'busy') return;
			set({state: 'starting', port, since: Date.now()});
			attempt();
		},
		stop() {
			if (timer) clearTimeout(timer);
			timer = undefined;
			const current = server;
			server = undefined;
			if (current) {
				current.closeAllConnections();
				current.close();
			}
			set({state: 'stopped'});
		},
		status: webStatus,
	};
}
