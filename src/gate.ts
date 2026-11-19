import type {WebResponse} from './types.js';

export type GateInput = {method: string; module: string; endpoint: string; headers: Readonly<Record<string, string>>};

export function admitRequest(_req: GateInput): WebResponse | undefined {
	// SEC-15: endpoint protection goes here
	return undefined;
}
