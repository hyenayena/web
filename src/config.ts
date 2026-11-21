export const DEFAULT_PORT = 80;
export const PORT_ENV = 'YENA_WEB_PORT';
// Inside the container; compose publishes the port on the host's 127.0.0.1 only.
export const BIND = '0.0.0.0';

export function originFor(port: number): string {
	return port === 80 ? 'http://127.0.0.1' : `http://127.0.0.1:${port}`;
}

export function readWebConfig(env: Readonly<Record<string, string | undefined>>): {port: number} | {error: string} {
	const raw = env[PORT_ENV];
	if (raw === undefined || raw === '') return {port: DEFAULT_PORT};
	if (/^\d{1,5}$/.test(raw)) {
		const port = Number(raw);
		if (port >= 1 && port <= 65535) return {port};
	}
	return {error: `Invalid ${PORT_ENV} (a port from 1 to 65535)`};
}
