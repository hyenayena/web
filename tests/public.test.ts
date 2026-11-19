import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const BANNED = /^(react|ink|node:http|node:https|node:net|node:fs|node:fs\/promises|node:child_process|http|https|net|fs|fs\/promises|child_process)$/;
const SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function graph(entry: string): Map<string, string> {
	const seen = new Map<string, string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (seen.has(file)) continue;
		const text = readFileSync(file, 'utf8');
		seen.set(file, text);
		for (const m of text.matchAll(SPEC)) {
			if (m[1]!.startsWith('.')) queue.push(path.resolve(path.dirname(file), m[1]!.replace(/\.js$/, '.ts')));
		}
	}
	return seen;
}

test('the public entry reaches no server, file or UI module', () => {
	const files = graph(path.join(SRC, 'public.ts'));
	const offenders: string[] = [];
	for (const [file, text] of files) {
		for (const m of text.matchAll(SPEC)) if (BANNED.test(m[1]!)) offenders.push(`${path.relative(SRC, file)}: ${m[1]}`);
	}
	assert.deepEqual(offenders, []);
	assert.equal([...files.keys()].some(f => /server|dispatch|commands/.test(path.basename(f))), false);
});

test('the public entry exports the registry API only', async () => {
	const pub = (await import('../src/public.js')) as Record<string, unknown>;
	assert.deepEqual(Object.keys(pub).sort(), ['DEFAULT_BODY_BYTES', 'MAX_BODY_BYTES', 'registerRoute', 'webBaseUrl', 'webRoutes', 'webStatus']);
	for (const hidden of ['configureWeb', 'setWebStatus', 'matchRoute', 'resetWebForTests']) assert.equal(hidden in pub, false);
});
