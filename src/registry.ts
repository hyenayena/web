import type {WebMethod, WebRoute, WebRouteInfo, WebStatus} from './types.js';
import {originFor} from './config.js';

export const MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_BODY_BYTES = 64 * 1024;
const MAX_ROUTES = 64;
const MAX_SEGMENTS = 8;
const MODULE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const METHODS: readonly WebMethod[] = ['GET', 'POST'];

const routes = new Map<string, WebRoute>();
let status: WebStatus = {state: 'stopped'};
let config: {port: number} | {error: string} | undefined;

const keyOf = (module: string, endpoint: string): string => `${module}/${endpoint}`;

export function registerRoute(route: WebRoute): () => void {
	if (typeof route !== 'object' || route === null) throw new Error('Invalid route');
	const {module, endpoint, methods, maxBodyBytes, handle} = route;
	if (typeof module !== 'string' || !MODULE_RE.test(module)) throw new Error('Invalid route module name');
	if (typeof endpoint !== 'string') throw new Error('Invalid route endpoint');
	const segments = endpoint.split('/');
	if (segments.length > MAX_SEGMENTS || segments.some(s => !SEGMENT_RE.test(s) || s === '.' || s === '..')) throw new Error('Invalid route endpoint');
	if (!Array.isArray(methods) || methods.length === 0 || methods.some(m => !METHODS.includes(m))) throw new Error('Invalid route methods');
	if (maxBodyBytes !== undefined && (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 0 || maxBodyBytes > MAX_BODY_BYTES)) {
		throw new Error(`Invalid route body limit (0 to ${MAX_BODY_BYTES})`);
	}
	if (typeof handle !== 'function') throw new Error('Invalid route handler');
	const key = keyOf(module, endpoint);
	if (routes.has(key)) throw new Error(`Route /${key} is already registered`);
	if (routes.size >= MAX_ROUTES) throw new Error(`At most ${MAX_ROUTES} routes can be registered`);
	const stored: WebRoute = {module, endpoint, methods: [...methods], ...(route.prefix === true && {prefix: true}), ...(maxBodyBytes !== undefined && {maxBodyBytes}), handle};
	routes.set(key, stored);
	return () => {
		if (routes.get(key) === stored) routes.delete(key);
	};
}

export function webRoutes(): WebRouteInfo[] {
	return [...routes.values()]
		.map(r => ({module: r.module, endpoint: r.endpoint, methods: [...r.methods], prefix: r.prefix === true}))
		.sort((a, b) => keyOf(a.module, a.endpoint).localeCompare(keyOf(b.module, b.endpoint)));
}

export function webStatus(): WebStatus {
	return Object.freeze({...status});
}

export function webBaseUrl(): string {
	if (!config) throw new Error('The web module is not loaded');
	if ('error' in config) throw new Error(config.error);
	return originFor(config.port);
}

export function configureWeb(next: {port: number} | {error: string}): void {
	config = next;
}

export function setWebStatus(next: WebStatus): void {
	status = {...next};
}

export function matchRoute(segments: readonly string[]): {route: WebRoute; rest: string[]} | undefined {
	const [module, ...tail] = segments;
	if (module === undefined) return undefined;
	let best: {route: WebRoute; rest: string[]; length: number} | undefined;
	for (const route of routes.values()) {
		if (route.module !== module) continue;
		const own = route.endpoint.split('/');
		if (tail.length < own.length || own.some((s, i) => s !== tail[i])) continue;
		if (tail.length > own.length && route.prefix !== true) continue;
		if (!best || own.length > best.length) best = {route, rest: tail.slice(own.length), length: own.length};
	}
	return best && {route: best.route, rest: best.rest};
}

export function resetWebForTests(): void {
	routes.clear();
	status = {state: 'stopped'};
	config = undefined;
}
