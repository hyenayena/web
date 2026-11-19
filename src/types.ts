export type WebMethod = 'GET' | 'POST';

export type WebRequest = {
	method: WebMethod;
	module: string;
	endpoint: string;
	rest: readonly string[];
	query: Readonly<Record<string, string>>;
	headers: Readonly<Record<string, string>>;
	body: Uint8Array;
};

export type WebResponse = {
	status: number;
	type?: string;
	body?: string | Uint8Array;
	headers?: Readonly<Record<string, string>>;
};

export type WebRoute = {
	module: string;
	endpoint: string;
	methods: readonly WebMethod[];
	prefix?: boolean;
	maxBodyBytes?: number;
	handle(req: WebRequest): WebResponse | Promise<WebResponse>;
};

export type WebState = 'stopped' | 'starting' | 'running' | 'busy' | 'failed';

export type WebStatus = {state: WebState; port?: number; baseUrl?: string; error?: string; since?: number};

export type WebRouteInfo = {module: string; endpoint: string; methods: readonly WebMethod[]; prefix: boolean};
