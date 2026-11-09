// node --test scripts/local-ports.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { isPortFree, localPorts, PORT_DEFAULTS, portSetting } from './local-ports.mjs';

test('defaults: database 54323, gateway 54321, SMTP 54326, Auth 54329, PostgREST 54328', () => {
  assert.deepEqual(localPorts({}, {}), { pg: 54323, supabase: 54321, smtp: 54326, auth: 54329, rest: 54328 });
  assert.equal(PORT_DEFAULTS.LOCAL_SMTP_PORT, 54326);
});

test('the environment wins over .env, and .env over the default', () => {
  assert.equal(portSetting('LOCAL_SMTP_PORT', { LOCAL_SMTP_PORT: '54400' }, { LOCAL_SMTP_PORT: '54500' }), 54400);
  assert.equal(portSetting('LOCAL_SMTP_PORT', {}, { LOCAL_SMTP_PORT: '54500' }), 54500);
  assert.equal(portSetting('LOCAL_SMTP_PORT', { LOCAL_SMTP_PORT: '' }, {}), 54326);
});

test('refuses values that are not usable ports, and two services on one port', () => {
  assert.throws(() => portSetting('LOCAL_PG_PORT', { LOCAL_PG_PORT: 'abc' }, {}), /LOCAL_PG_PORT/);
  assert.throws(() => portSetting('LOCAL_PG_PORT', { LOCAL_PG_PORT: '80' }, {}), /1024 to 65535/);
  assert.throws(() => localPorts({ LOCAL_SMTP_PORT: '54321' }, {}), /both set to port 54321/);
});

test('reports a port another program holds as taken, and a free one as free', async () => {
  const holder = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => holder.once('listening', resolve));
  const { port } = holder.address();
  assert.equal(await isPortFree(port), false);
  await new Promise((resolve) => holder.close(resolve));
  assert.equal(await isPortFree(port), true);
});
