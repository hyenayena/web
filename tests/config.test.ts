import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readWebConfig} from '../src/config.js';

test('unset or empty uses the default port', () => {
	assert.deepEqual(readWebConfig({}), {port: 7300});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: ''}), {port: 7300});
});

test('a valid port is used', () => {
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '8080'}), {port: 8080});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '1024'}), {port: 1024});
	assert.deepEqual(readWebConfig({YENA_WEB_PORT: '65535'}), {port: 65535});
});

test('an invalid value is refused without being echoed', () => {
	for (const v of ['80', '1023', '65536', '99999', '123456', 'abc', '80a0', ' 8080', '-5', '8080.5']) {
		const r = readWebConfig({YENA_WEB_PORT: v});
		assert.ok('error' in r, v);
		assert.equal(r.error.includes(v), false);
	}
});
