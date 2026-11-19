import type {Logger} from '../../../src/api.js';
import {admitRequest, type GateInput} from './gate.js';
import {DEFAULT_BODY_BYTES, matchRoute} from './registry.js';
import type {WebMethod, WebRequest, WebResponse, WebRoute} from './types.js';

export const MAX_URL_CHARS = 2048;
const MAX_QUERY_KEYS = 32;
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const HEADER_VALUE_BAD = /[\r\n]/;
const RAW_BAD_ESCAPE = /%(?:2f|5c|00)/i;
const DROPPED_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'content-type']);

export const FIXED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'Cache-Control': 'no-store',
	'X-Frame-Options': 'DENY',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
});

export type Resolved =
	| {ok: true; route: WebRoute; request: Omit<WebRequest, 'body'>; maxBody: number}
	| {ok: false; response: WebResponse};

export type RawRequest = {method: string; url: string; headers: Readonly<Record<string, string | string[] | undefined>>};

const fail = (status: number, text: string, headers?: Record<string, string>): Resolved => ({
	ok: false,
	response: {status, body: text, ...(headers && {headers})},
});

function splitPath(path: string): string[] | undefined {
	if (!path.startsWith('/') || RAW_BAD_ESCAPE.test(path)) return undefined;
	const raw = path.slice(1).split('/');
	if (raw[raw.length - 1] === '') raw.pop();
	const out: string[] = [];
	for (const part of raw) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(part);
		} catch {
			return undefined;
		}
		if (decoded === '' || decoded === '.' || decoded === '..' || decoded.includes('\\') || decoded.includes('/') || CONTROL.test(decoded)) return undefined;
		out.push(decoded);
	}
	return out;
}

function parseQuery(search: string): Record<string, string> | undefined {
	const query: Record<string, string> = Object.create(null) as Record<string, string>;
	let keys = 0;
	for (const [key, value] of new URLSearchParams(search)) {
		if (key in query) continue;
		if (++keys > MAX_QUERY_KEYS) return undefined;
		query[key] = value;
	}
	return query;
}

export function lowerHeaders(headers: RawRequest['headers']): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
	}
	return out;
}

export function resolveRequest(raw: RawRequest, gate: (req: GateInput) => WebResponse | undefined = admitRequest): Resolved {
	const {url} = raw;
	if (typeof url !== 'string' || url.length > MAX_URL_CHARS) return fail(414, 'URI too long');
	if (!url.startsWith('/') || CONTROL.test(url)) return fail(400, 'Bad request');
	const cut = url.indexOf('?');
	const segments = splitPath(cut === -1 ? url : url.slice(0, cut));
	if (!segments) return fail(400, 'Bad request');
	const query = parseQuery(cut === -1 ? '' : url.slice(cut + 1));
	if (!query) return fail(400, 'Bad request');
	if (raw.method !== 'GET' && raw.method !== 'POST') return fail(405, 'Method not allowed', {Allow: 'GET, POST'});
	const method: WebMethod = raw.method;
	const match = matchRoute(segments);
	if (!match) return fail(404, 'Not found');
	const {route, rest} = match;
	if (!route.methods.includes(method)) return fail(405, 'Method not allowed', {Allow: route.methods.join(', ')});
	const headers = lowerHeaders(raw.headers);
	const refused = gate({method, module: route.module, endpoint: route.endpoint, headers});
	if (refused) return {ok: false, response: refused};
	return {
		ok: true,
		route,
		request: {method, module: route.module, endpoint: route.endpoint, rest, query, headers},
		maxBody: method === 'POST' ? (route.maxBodyBytes ?? DEFAULT_BODY_BYTES) : 0,
	};
}

const internalError = (): WebResponse => ({status: 500, body: 'Internal error'});

export async function invokeRoute(route: WebRoute, req: WebRequest, log: Logger): Promise<WebResponse> {
	let resp: WebResponse;
	try {
		resp = await route.handle(req);
	} catch (err) {
		log.warn('web handler failed', {module: route.module, endpoint: route.endpoint, err});
		return internalError();
	}
	const ok =
		typeof resp === 'object' &&
		resp !== null &&
		Number.isInteger(resp.status) &&
		resp.status >= 100 &&
		resp.status <= 599 &&
		(resp.body === undefined || typeof resp.body === 'string' || resp.body instanceof Uint8Array) &&
		(resp.type === undefined || (typeof resp.type === 'string' && !CONTROL.test(resp.type)));
	if (!ok) {
		log.warn('web handler returned an invalid response', {module: route.module, endpoint: route.endpoint});
		return internalError();
	}
	return resp;
}

export function encodeBody(resp: WebResponse): Uint8Array {
	if (resp.body === undefined) return new Uint8Array(0);
	return typeof resp.body === 'string' ? new TextEncoder().encode(resp.body) : resp.body;
}

export function finalHeaders(resp: WebResponse): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(resp.headers ?? {})) {
		const lower = name.toLowerCase();
		if (!HEADER_NAME.test(name) || typeof value !== 'string' || HEADER_VALUE_BAD.test(value)) continue;
		if (lower.startsWith('access-control-') || DROPPED_HEADERS.has(lower)) continue;
		out[name] = value;
	}
	for (const key of Object.keys(out)) {
		if (key.toLowerCase() in lowerFixed) delete out[key];
	}
	out['Content-Type'] = resp.type ?? 'text/plain; charset=utf-8';
	return {...out, ...FIXED_HEADERS};
}

const lowerFixed: Record<string, true> = Object.fromEntries(Object.keys(FIXED_HEADERS).map(k => [k.toLowerCase(), true as const]));
