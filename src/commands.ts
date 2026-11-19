import type {Command, CommandContext, Logger} from '../../../src/api.js';
import {commandError, line, printStyled, span, table} from './deps/core.js';
import {webRoutes} from './registry.js';
import type {ServerControl} from './server.js';
import type {WebStatus} from './types.js';

const RETRY_SECONDS = 30;
const NOT_RUNNING = 'not running in this process; it runs while the yena app is open';

export type WebCommandDeps = {control: ServerControl; log: Logger};

function serverText(status: WebStatus, headless: boolean): string {
	if (headless) return NOT_RUNNING;
	switch (status.state) {
		case 'running':
			return 'running';
		case 'starting':
			return 'starting';
		case 'busy':
			return `port ${status.port} is busy (another program or yena uses it); retrying every ${RETRY_SECONDS} s`;
		case 'failed':
			return `failed: ${status.error ?? 'unknown error'}`;
		default:
			return NOT_RUNNING;
	}
}

function printStatus(ctx: CommandContext, status: WebStatus): void {
	const headless = ctx.headless === true;
	const shown = headless ? ({state: 'stopped'} as WebStatus) : status;
	const tone = shown.state === 'running' ? 'ok' : shown.state === 'failed' ? 'error' : shown.state === 'busy' ? 'warn' : 'muted';
	const blocks = [
		line(span('Server   ', {tone: 'muted'}), span(serverText(status, headless), {tone})),
		line(span('Address  ', {tone: 'muted'}), shown.baseUrl ?? '-'),
		line(span('Port     ', {tone: 'muted'}), shown.port === undefined ? '-' : String(shown.port)),
	];
	const routes = webRoutes();
	if (routes.length === 0) {
		printStyled(ctx, [...blocks, line(span('No module has registered a page.', {tone: 'muted'}))]);
		return;
	}
	const rows = routes.map(r => [r.module, `/${r.module}/${r.endpoint}${r.prefix ? '/…' : ''}`, r.methods.join(', ')]);
	printStyled(ctx, [...blocks, line(''), table(rows, {head: ['Module', 'Path', 'Methods']})]);
}

export function createWebCommand(deps: WebCommandDeps): Command {
	let exitHooked = false;
	let autostarted = false;
	return {
		name: 'web',
		description: 'The local web server that serves module pages',
		usage: 'web <subcommand>',
		args: [{name: 'subcommand', description: 'status'}],
		autostart: true,
		agent: 'safe',
		subcommands: [{name: 'status', usage: 'web status', description: 'Show the server state, its address and the routes', agent: 'safe'}],
		async run(args, ctx) {
			if (ctx.headless !== true) {
				deps.control.start();
				if (!exitHooked) {
					exitHooked = true;
					process.once('exit', deps.control.stop);
				}
			}
			const [sub, ...rest] = args;
			if (sub === undefined) {
				if (!autostarted) {
					autostarted = true;
					return;
				}
				if (ctx.showHelp) ctx.showHelp();
				else ctx.print('web <subcommand>');
				return;
			}
			autostarted = true;
			if (sub !== 'status') throw commandError('usage', `Unknown subcommand: ${sub.slice(0, 64)}. See "web help"`);
			if (rest.length > 0) throw commandError('usage', 'Usage: web status');
			printStatus(ctx, deps.control.status());
		},
	};
}
