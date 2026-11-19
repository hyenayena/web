import type {ModulePlugin} from '../../../src/api.js';
import {createWebCommand} from './commands.js';
import {BIND, readWebConfig} from './config.js';
import {noopLog} from './log.js';
import {configureWeb, setWebStatus} from './registry.js';
import {createServerControl, type ServerControl} from './server.js';

const plugin: ModulePlugin = host => {
	const log = (host.log ?? noopLog).child('web');
	const config = readWebConfig(process.env);
	configureWeb(config);
	let created: ServerControl | undefined;
	const control: ServerControl = {
		start() {
			if ('error' in config) {
				setWebStatus({state: 'failed', error: config.error});
				return;
			}
			created ??= createServerControl({port: config.port, bind: BIND, log});
			created.start();
		},
		stop() {
			created?.stop();
		},
		status() {
			return created ? created.status() : {state: 'stopped'};
		},
	};
	log.debug('plugin loaded');
	return [createWebCommand({control, log})];
};

export default plugin;
