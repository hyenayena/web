import assert from 'node:assert/strict';
import {test} from 'node:test';
import {originFor, readWebConfig} from '../src/config.js';

test('unset or empty uses the default port', () => {
	assert.deepEqual(readWebConfig({}), {port: 80});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: ''}), {port: 80});
});

test('a valid port is used', () => {
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '8080'}), {port: 8080});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '1024'}), {port: 1024});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '1'}), {port: 1});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '65535'}), {port: 65535});
});

test('an invalid value is refused without being echoed', () => {
	for (const v of ['0', '65536', '99999', '123456', 'abc', '80a0', ' 8080', '-5', '8080.5']) {
		const r = readWebConfig({YENA_WEB_PORT: v});
		assert.ok('error' in r, v);
		assert.equal(r.error.includes(v), false);
	}
});

test('the standard port is left out of the address', () => {
	assert.equal(originFor(80), 'http://127.0.0.1');
	assert.equal(originFor(8080), 'http://127.0.0.1:8080');
});
