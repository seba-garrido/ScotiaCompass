import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, BSON } from 'mongodb';
import { createApp } from '../server/app.mjs';
import { createConnectionStore } from '../server/connection-store.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ObjectId, Long, Decimal128, Binary, Int32, Double, Timestamp } = BSON;
let mongod, mongo, instance, server, base, collection;
const audit = [];
const ctx = { connection: 'test', database: 'workspace', collection: 'EventLog' };
function requestJson(url, body, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const request = httpRequest(url, { method, headers: { 'X-Scotia-Client': '1', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(data), cookie: response.headers['set-cookie']?.[0] }));
    });
    request.on('error', reject); request.end(payload);
  });
}
async function call(route, body, method = body ? 'POST' : 'GET', extra = {}) { return requestJson(`${base}/api/${route}`, body, method, extra); }
async function query(filter = {}, extra = {}) { return call('query', { ...ctx, filter, ...extra }); }
before(async () => {
  mongod = await MongoMemoryServer.create();
  mongo = await new MongoClient(mongod.getUri()).connect();
  collection = mongo.db('workspace').collection('EventLog');
  await collection.insertMany(Array.from({ length: 25 }, (_, i) => ({ sequence: i, status: i % 2 ? 'ERROR' : 'SUCCESS' })));
  const listener = await new Promise(resolve => { const s = createApp({ connections: [], audit: () => {} }).app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  instance = createApp({ allowedOrigin: base, connections: [
    { id: 'test', name: 'Test', uri: mongod.getUri(), provider: 'Atlas', environment: 'IST' },
    { id: 'prod', name: 'Prod', uri: mongod.getUri(), provider: 'Atlas', environment: 'PROD' },
    { id: 'readonly', name: 'Read only', uri: mongod.getUri(), provider: 'Anthos', environment: 'UAT', readOnly: true },
    { id: 'scoped', name: 'Scoped', uri: mongod.getUri(), provider: 'Atlas', environment: 'IST', database: 'workspace' }
  ], audit: entry => audit.push(entry) });
  server = await new Promise(resolve => { const s = instance.app.listen(port, '127.0.0.1', () => resolve(s)); });
  for (const id of ['test', 'prod', 'readonly', 'scoped']) assert.equal((await call(`connections/${id}/connect`, {})).status, 200);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await instance?.close(); await mongo?.close(); await mongod?.stop(); });

test('connection catalog redacts URI and lists databases / collections', async () => {
  const result = await call('connections');
  assert.equal(result.status, 200); assert.equal(result.data.length, 4);
  assert.equal(JSON.stringify(result.data).includes('mongodb://'), false);
  assert.deepEqual((await call('databases?connection=scoped')).data, ['workspace']);
  assert.ok((await call('collections?connection=test&database=workspace')).data.includes('EventLog'));
});
test('query filtering, sort, projection and paginated boundary', async () => {
  const first = await query({}, { limit: 10, sort: { sequence: 1 } });
  assert.equal(first.data.documents.length, 10); assert.equal(first.data.hasMore, true);
  const last = await query({}, { limit: 10, skip: 20, sort: { sequence: 1 } });
  assert.equal(last.data.documents.length, 5); assert.equal(last.data.hasMore, false);
  const filtered = await query({ status: 'ERROR' }, { projection: { status: 1 } });
  assert.equal(filtered.data.documents.length, 12); assert.equal(filtered.data.revisions.length, 0);
  assert.equal(filtered.data.documents[0].sequence, undefined);
});
test('CRUD preserves BSON values and checks immutable ID', async () => {
  const original = { _id: new ObjectId(), label: 'typed document', when: new Date('2026-01-02T03:04:05Z'), large: Long.fromString('9007199254740993'), amount: Decimal128.fromString('123.456'), bin: new Binary(Buffer.from([0, 1, 2, 3]), 4), integer: new Int32(12), double: new Double(12), stamp: new Timestamp({ t: 42, i: 1 }) };
  // UUID subtype requires 16 bytes; use generic binary to verify arbitrary bytes.
  original.bin = new Binary(Buffer.from([0, 1, 2, 3]), 0);
  const doc = BSON.EJSON.serialize(original, { relaxed: false });
  const inserted = await call('documents', { ...ctx, document: doc }); assert.equal(inserted.status, 201);
  const found = await query({ _id: doc._id }); assert.equal(found.status, 200);
  assert.deepEqual(found.data.documents[0], doc);
  const changed = { ...found.data.documents[0], label: 'edited' };
  const badId = await call('documents', { ...ctx, id: doc._id, revision: found.data.revisions[0], document: { ...changed, _id: { $oid: new ObjectId().toHexString() } } }, 'PUT');
  assert.equal(badId.status, 400);
  const update = await call('documents', { ...ctx, id: doc._id, revision: found.data.revisions[0], document: changed }, 'PUT');
  assert.equal(update.status, 200, JSON.stringify(update.data));
  const after = await query({ _id: doc._id }); assert.deepEqual(after.data.documents[0], changed);
  const deleted = await call('documents', { ...ctx, id: doc._id, revision: after.data.revisions[0] }, 'DELETE');
  assert.equal(deleted.data.deletedCount, 1);
  assert.equal((await query({ _id: doc._id })).data.documents.length, 0);
  assert.ok(audit.some(e => e.action === 'replace')); assert.equal(JSON.stringify(audit).includes('typed document'), false);
});
test('concurrent changes cause conflict, including deletes', async () => {
  const found = await query({ sequence: 0 });
  const doc = found.data.documents[0];
  await collection.updateOne({ sequence: 0 }, { $set: { external: true } });
  const body = { ...ctx, id: doc._id, revision: found.data.revisions[0], document: { ...doc, status: 'EDITED' } };
  assert.equal((await call('documents', body, 'PUT')).status, 409);
  assert.equal((await call('documents', body, 'DELETE')).status, 409);
  assert.equal((await collection.findOne({ sequence: 0 })).external, true);
});
test('production and read-only connections cannot write by default', async () => {
  for (const connection of ['prod', 'readonly']) {
    const result = await call('documents', { ...ctx, connection, document: { value: 1 }, confirmProduction: 'EventLog' });
    assert.equal(result.status, 403);
  }
});
test('query limits, JavaScript operators, malformed requests and missing revisions are rejected', async () => {
  for (const extra of [{ limit: 0 }, { limit: 101 }, { skip: -1 }, { skip: 100001 }, { sort: { sequence: 'desc' } }]) assert.equal((await query({}, extra)).status, 400);
  assert.equal((await query({ $where: 'return true' })).status, 400);
  assert.equal((await query({ _id: { $oid: 'bad' } })).status, 400);
  assert.equal((await call('documents', { ...ctx, id: {}, document: {} }, 'PUT')).status, 400);
  assert.equal((await call('documents', { ...ctx, collection: 'DoesNotExist', document: {} })).status, 404);
});
test('operator-like document IDs cannot broaden delete scope', async () => {
  const found = await query({ sequence: 1 });
  const result = await call('documents', { ...ctx, id: { $ne: null }, revision: found.data.revisions[0] }, 'DELETE');
  assert.equal(result.status, 404);
  assert.equal(await collection.countDocuments({}), 25);
});
test('same-origin protection blocks cross-site requests, untrusted hosts and missing headers', async () => {
  assert.equal((await call('connections', undefined, 'GET', { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await call('connections', undefined, 'GET', { Host: 'evil.invalid' })).status, 403);
  assert.equal((await fetch(`${base}/api/connections`)).status, 403);
});
test('token authentication, logout and production confirmation on enabled server', async () => {
  const authed = createApp({ allowedOrigin: 'http://127.0.0.1:4318', accessToken: 'a-test-only-access-token-123456', enableProductionWrites: true, connections: [{ id: 'prod', uri: mongod.getUri(), provider: 'Atlas', environment: 'PROD', name: 'Production' }], audit: () => {} });
  const s = await new Promise(resolve => { const server = authed.app.listen(0, '127.0.0.1', () => resolve(server)); });
  async function request(route, body, cookie, method) {
    return requestJson(`http://127.0.0.1:${s.address().port}/api/${route}`, body, method || (body ? 'POST' : 'GET'), { Host: '127.0.0.1:4318', ...(cookie ? { Cookie: cookie } : {}) });
  }
  try {
    assert.equal((await request('connections')).status, 401);
    assert.equal((await request('session', { token: 'wrong' })).status, 401);
    const login = await request('session', { token: 'a-test-only-access-token-123456' });
    assert.equal(login.status, 200); assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /SameSite=Strict/);
    const cookie = login.cookie.split(';')[0];
    assert.equal((await request('connections', null, cookie)).status, 200);
    assert.equal((await request('connections/prod/connect', {}, cookie)).status, 200);
    const write = { ...ctx, connection: 'prod', document: { productionTest: true } };
    assert.equal((await request('documents', write, cookie)).status, 403);
    assert.equal((await request('documents', { ...write, confirmProduction: 'EventLog' }, cookie)).status, 201);
    assert.equal((await request('session', null, cookie, 'DELETE')).status, 200);
    assert.equal((await request('connections', null, cookie)).status, 401);
  } finally { await new Promise(resolve => s.close(resolve)); await authed.close(); }
});
test('profiles start empty, save only on success, disconnect, survive restart, reconnect, edit and delete', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'scotia-profiles-'));
  const store = createConnectionStore(directory);
  let runtime, listener, fail = false;
  async function start() {
    runtime = createApp({ allowedOrigin: 'http://127.0.0.1:4318', connections: await store.load(), saveConnections: entries => store.save(entries), clientFactory: uri => {
      if (fail) throw Object.assign(new Error('must-not-leak-credentials'), { name: 'MongoNetworkError' });
      return new MongoClient(uri);
    } });
    listener = await new Promise(resolve => { const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s)); });
  }
  const request = (route, body, method = body ? 'POST' : 'GET') => requestJson(`http://127.0.0.1:${listener.address().port}/api/${route}`, body, method, { Host: '127.0.0.1:4318' });
  async function stop() { await new Promise(resolve => listener.close(resolve)); await runtime.close(); }
  try {
    await start();
    assert.deepEqual((await request('connections')).data, []);
    const config = { name: 'Mi conexión', uri: mongod.getUri(), provider: 'Atlas', environment: 'IST', database: 'workspace', color: 'violet' };
    fail = true;
    const failed = await request('connections', config);
    assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.data).includes('must-not-leak'), false);
    assert.deepEqual((await request('connections')).data, []); assert.deepEqual(await store.load(), []);
    fail = false;
    const added = await request('connections', config);
    assert.equal(added.status, 201); assert.equal(added.data.status, 'connected'); assert.equal(added.data.uri, undefined);
    const id = added.data.id;
    const ciphertext = await readFile(path.join(directory, 'connections.enc'));
    assert.equal(ciphertext.includes(Buffer.from('mongodb://')), false); assert.equal(ciphertext.includes(Buffer.from('Mi conexión')), false);
    assert.equal((await request(`connections/${id}/disconnect`, {})).data.status, 'disconnected');
    assert.equal((await request('connections')).data.length, 1);
    assert.equal((await request(`databases?connection=${id}`)).status, 409);
    await stop(); await start();
    const restored = (await request('connections')).data;
    assert.equal(restored.length, 1); assert.equal(restored[0].id, id); assert.equal(restored[0].status, 'disconnected');
    fail = true;
    assert.equal((await request(`connections/${id}/connect`, {})).status, 503);
    assert.equal((await request('connections')).data[0].status, 'disconnected');
    fail = false;
    assert.equal((await request(`connections/${id}/connect`, {})).data.status, 'connected');
    assert.deepEqual((await request(`databases?connection=${id}`)).data, ['workspace']);
    assert.equal((await request(`connections/${id}`, { ...config, name: 'Nombre personalizado', uri: '' }, 'PUT')).data.name, 'Nombre personalizado');
    assert.equal((await store.load())[0].uri, config.uri);
    assert.equal((await request(`connections/${id}`, null, 'DELETE')).status, 200);
    assert.deepEqual(await store.load(), []);
  } finally { if (listener?.listening) await stop(); await rm(directory, { recursive: true, force: true }); }
});
test('corrupt encrypted catalog fails closed instead of silently resetting profiles', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'scotia-key-'));
  try {
    const store = createConnectionStore(directory);
    await store.save([{ id: 'sample', uri: 'mongodb://fake:secret@demo.invalid' }]);
    const file = path.join(directory, 'connections.enc');
    const original = await readFile(file); const tampered = Buffer.from(original); tampered[tampered.length - 1] ^= 1;
    await writeFile(file, tampered);
    await assert.rejects(() => store.load(), /descifrar/);
    assert.deepEqual(await readFile(file), tampered);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
