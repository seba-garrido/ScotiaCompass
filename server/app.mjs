import express from 'express';
import { MongoClient, BSON } from 'mongodb';
import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { EJSON } = BSON;
const encode = value => EJSON.serialize(value, { relaxed: false });
const decode = value => EJSON.deserialize(value, { relaxed: false });
export const revision = value => createHash('sha256').update(EJSON.stringify(value, { relaxed: false })).digest('hex');
class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requireValue = (ok, message, status = 400) => { if (!ok) throw new RequestError(status, message); };
function object(value, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} debe ser un objeto JSON.`);
  return value;
}
function validateOperators(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(!['$where', '$function', '$accumulator', '__proto__', 'constructor', 'prototype'].includes(key), `El operador ${key} no está habilitado.`);
    validateOperators(child);
  }
}
function namespace(value, label) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 120 && !value.includes('\0'), `${label} inválida.`);
  return value;
}
export function createApp({ connections = [], saveConnections = async () => {}, accessToken = '', allowedOrigin = 'http://127.0.0.1:4317', enableProductionWrites = false, audit = record => console.log(JSON.stringify(record)), clientFactory = uri => new MongoClient(uri, {
  maxPoolSize: 8, minPoolSize: 0, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 20000, waitQueueTimeoutMS: 10000,
  promoteLongs: false, promoteValues: false, appName: 'ScotiaCompass'
}) } = {}) {
  const app = express();
  const registry = new Map(connections.map(c => [c.id, { ...c }]));
  const pools = new Map();
  const publicConnection = c => ({ id: c.id, name: c.name, environment: c.environment, provider: c.provider, database: c.database || '', readOnly: Boolean(c.readOnly) || (c.environment === 'PROD' && !enableProductionWrites), color: c.color || 'red', status: pools.has(c.id) ? 'connected' : 'disconnected' });
  let connectionQueue = Promise.resolve();
  function changeConnection(task) { const result = connectionQueue.then(task); connectionQueue = result.catch(() => {}); return result; }
  async function persist(entries) {
    try { await saveConnections(entries); } catch { throw new RequestError(503, 'No se pudo guardar la conexión en el servidor. Revisa el directorio de datos.'); }
  }
  async function testClient(config) {
    const client = clientFactory(config.uri);
    try { await client.connect(); await client.db(config.database || undefined).command({ ping: 1 }, { maxTimeMS: 8000 }); return client; }
    catch (error) { await client.close().catch(() => {}); throw error; }
  }
  const sessions = new Map();
  const loginAttempts = new Map();
  const approved = new URL(allowedOrigin);
  const allowedHosts = new Set([approved.host]);
  if (['localhost', '127.0.0.1', '[::1]'].includes(approved.hostname)) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) allowedHosts.add(`${host}:${approved.port || '80'}`);
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!allowedHosts.has(req.headers.host)) return res.status(403).json({ error: 'Host no autorizado. Configura APP_ORIGIN.' });
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return res.status(403).json({ error: 'Origen inválido.' }); }
      if (origin.protocol !== approved.protocol || !allowedHosts.has(origin.host)) return res.status(403).json({ error: 'Origen no autorizado.' });
    }
    if (req.headers['x-scotia-client'] !== '1') return res.status(403).json({ error: 'Cabecera de cliente requerida.' });
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));
  const isAuthenticated = req => {
    if (!accessToken) return true;
    const sid = /(?:^|;\s*)scotia_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    return !!sid && (sessions.get(sid) || 0) > Date.now();
  };
  app.get('/api/meta', (req, res) => res.json({ available: true, requiresAuth: !!accessToken, authenticated: isAuthenticated(req) }));
  app.post('/api/session', (req, res) => {
    const ip = req.socket.remoteAddress;
    const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempt.until > Date.now() && attempt.count >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto.' });
    const provided = typeof req.body?.token === 'string' ? req.body.token : '';
    const equal = timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(accessToken).digest());
    if (!equal) {
      loginAttempts.set(ip, { count: attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 60000 });
      return res.status(401).json({ error: 'Clave de acceso incorrecta.' });
    }
    loginAttempts.delete(ip);
    for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, Date.now() + 8 * 3600000);
    res.cookie('scotia_session', sid, { httpOnly: true, sameSite: 'strict', secure: approved.protocol === 'https:', maxAge: 8 * 3600000, path: '/api' });
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => isAuthenticated(req) ? next() : res.status(401).json({ error: 'Inicia sesión para acceder a MongoDB.' }));
  app.delete('/api/session', (req, res) => {
    const sid = /(?:^|;\s*)scotia_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    sessions.delete(sid);
    res.clearCookie('scotia_session', { path: '/api' }).json({ ok: true });
  });
  async function getClient(id) {
    const config = registry.get(id);
    requireValue(config, 'Conexión no encontrada.', 404);
    requireValue(pools.has(id), 'Esta conexión está desconectada. Presiona Conectar para usarla.', 409);
    return pools.get(id);
  }
  async function getCollection(body, write = false) {
    const config = registry.get(body.connection);
    requireValue(config, 'Conexión no encontrada.', 404);
    const db = namespace(body.database, 'Base de datos');
    const name = namespace(body.collection, 'Colección');
    if (write) {
      requireValue(!config.readOnly, 'Esta conexión es de solo lectura.', 403);
      if (config.environment === 'PROD') {
        requireValue(enableProductionWrites, 'Las escrituras en producción no están habilitadas en el servidor.', 403);
        requireValue(body.confirmProduction === name, 'Confirma el nombre de la colección de producción.', 403);
      }
      requireValue(!name.startsWith('system.'), 'Las colecciones del sistema son de solo lectura.', 403);
      const client = await getClient(body.connection);
      const exists = await client.db(db).listCollections({ name }, { nameOnly: true, maxTimeMS: 8000 }).hasNext();
      requireValue(exists, 'La colección ya no existe. Actualiza el explorador.', 404);
    }
    return (await getClient(body.connection)).db(db).collection(name);
  }
  function log(action, body, result) { audit({ time: new Date().toISOString(), action, connection: body.connection, database: body.database, collection: body.collection, result }); }
  app.get('/api/connections', (req, res) => res.json([...registry.values()].map(publicConnection)));
  function connectionConfig(b, previous) {
    object(b, 'La conexión');
    b = { ...b, uri: b.uri || previous?.uri };
    requireValue(typeof b.uri === 'string' && /^mongodb(?:\+srv)?:\/\//.test(b.uri) && b.uri.length < 8000, 'Ingresa una URI mongodb:// o mongodb+srv:// válida.');
    requireValue(typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 80, 'Ingresa un nombre de hasta 80 caracteres.');
    requireValue(['IST', 'UAT', 'PROD'].includes(b.environment) && ['Atlas', 'Anthos'].includes(b.provider), 'Ambiente o proveedor inválido.');
    requireValue(!b.color || ['red', 'teal', 'blue', 'violet', 'amber'].includes(b.color), 'Color inválido.');
    if (b.database) namespace(b.database, 'Base de datos');
    return { id: previous?.id || randomUUID(), name: b.name.trim(), uri: b.uri, environment: b.environment, provider: b.provider, database: b.database || '', readOnly: b.readOnly === true, color: b.color || 'red' };
  }
  async function saveAndConnect(b, previous) {
    const config = connectionConfig(b, previous);
    const client = await testClient(config);
    try { await persist([...registry.values()].filter(c => c.id !== config.id).concat(config)); }
    catch (error) { await client.close(); throw error; }
    const oldClient = pools.get(config.id);
    registry.set(config.id, config); pools.set(config.id, client);
    if (oldClient) await oldClient.close().catch(() => {});
    return publicConnection(config);
  }
  app.post('/api/connections', async (req, res) => {
    res.status(201).json(await changeConnection(async () => {
      requireValue(registry.size < 30, 'Máximo de 30 conexiones por instancia.');
      return saveAndConnect(req.body);
    }));
  });
  app.put('/api/connections/:id', async (req, res) => {
    res.json(await changeConnection(async () => {
      const previous = registry.get(req.params.id);
      requireValue(previous, 'Conexión no encontrada.', 404);
      return saveAndConnect(req.body, previous);
    }));
  });
  app.post('/api/connections/:id/connect', async (req, res) => {
    res.json(await changeConnection(async () => {
      const config = registry.get(req.params.id);
      requireValue(config, 'Conexión no encontrada.', 404);
      if (!pools.has(config.id)) pools.set(config.id, await testClient(config));
      return publicConnection(config);
    }));
  });
  app.post('/api/connections/:id/disconnect', async (req, res) => {
    res.json(await changeConnection(async () => {
      const config = registry.get(req.params.id);
      requireValue(config, 'Conexión no encontrada.', 404);
      const client = pools.get(config.id); pools.delete(config.id);
      if (client) await client.close().catch(() => {});
      return publicConnection(config);
    }));
  });
  app.delete('/api/connections/:id', async (req, res) => {
    res.json(await changeConnection(async () => {
      requireValue(registry.has(req.params.id), 'Conexión no encontrada.', 404);
      await persist([...registry.values()].filter(c => c.id !== req.params.id));
      const client = pools.get(req.params.id); pools.delete(req.params.id); registry.delete(req.params.id);
      if (client) await client.close().catch(() => {});
      return { ok: true };
    }));
  });
  app.get('/api/databases', async (req, res) => {
    const client = await getClient(req.query.connection);
    const config = registry.get(req.query.connection);
    // An explicit database also supports users without listDatabases privileges.
    if (config.database) { await client.db(config.database).command({ ping: 1 }); return res.json([config.database]); }
    const result = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true, maxTimeMS: 8000 });
    res.json(result.databases.map(db => db.name).sort());
  });
  app.get('/api/collections', async (req, res) => {
    const client = await getClient(req.query.connection);
    const result = await client.db(namespace(req.query.database, 'Base')).listCollections({}, { nameOnly: true, maxTimeMS: 8000 }).toArray();
    res.json(result.map(c => c.name).sort());
  });
  app.post('/api/query', async (req, res) => {
    const b = req.body;
    const filter = object(b.filter ?? {}, 'El filtro');
    const sort = object(b.sort ?? { _id: 1 }, 'El orden');
    const projection = object(b.projection ?? {}, 'La proyección');
    validateOperators({ filter, sort, projection });
    for (const direction of Object.values(sort)) requireValue(direction === 1 || direction === -1, 'Usa 1 o -1 para ordenar.');
    for (const value of Object.values(projection)) requireValue([0, 1, true, false].includes(value), 'La proyección admite inclusión (1) o exclusión (0).');
    const limit = b.limit ?? 20, skip = b.skip ?? 0;
    requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'El límite debe estar entre 1 y 100.');
    requireValue(Number.isInteger(skip) && skip >= 0 && skip <= 100000, 'El salto debe estar entre 0 y 100000. Filtra por _id para navegar más lejos.');
    const collection = await getCollection(b);
    const start = performance.now();
    const cursor = collection.find(decode(filter), { projection, sort, skip, limit: limit + 1, maxTimeMS: 10000, promoteLongs: false, promoteValues: false });
    let docs;
    try { docs = await cursor.toArray(); } finally { await cursor.close(); }
    const hasMore = docs.length > limit;
    docs = docs.slice(0, limit);
    res.json({ documents: docs.map(encode), revisions: Object.keys(projection).length ? [] : docs.map(revision), hasMore, duration: Math.round(performance.now() - start), skip, limit });
  });
  app.post('/api/stats', async (req, res) => {
    const collection = await getCollection(req.body);
    res.json({ estimatedCount: Number(await collection.estimatedDocumentCount({ maxTimeMS: 5000 })) });
  });
  app.post('/api/indexes', async (req, res) => {
    const collection = await getCollection(req.body);
    res.json(EJSON.serialize(await collection.listIndexes({ maxTimeMS: 8000 }).toArray(), { relaxed: true }));
  });
  app.post('/api/documents', async (req, res) => {
    const b = req.body;
    const document = decode(object(b.document, 'El documento'));
    const collection = await getCollection(b, true);
    const result = await collection.insertOne(document, { maxTimeMS: 10000 });
    log('insert', b, 'ok');
    res.status(201).json({ insertedId: encode(result.insertedId) });
  });
  async function originalDocument(collection, body) {
    requireValue(Object.hasOwn(body, 'id') && body.id !== undefined, 'Falta el _id del documento.');
    requireValue(typeof body.revision === 'string' && /^[a-f0-9]{64}$/.test(body.revision), 'Vuelve a consultar el documento completo antes de modificarlo.');
    // $eq treats an object-valued _id as a literal, never as a query operator.
    const original = await collection.findOne({ _id: { $eq: decode(body.id) } }, { maxTimeMS: 10000, promoteLongs: false, promoteValues: false });
    requireValue(original, 'El documento ya no existe.', 404);
    requireValue(revision(original) === body.revision, 'El documento cambió. Actualiza los resultados antes de continuar.', 409);
    return original;
  }
  app.put('/api/documents', async (req, res) => {
    const b = req.body;
    const collection = await getCollection(b, true);
    const original = await originalDocument(collection, b);
    const document = decode(object(b.document, 'El documento'));
    requireValue(EJSON.stringify(document._id, { relaxed: false }) === EJSON.stringify(original._id, { relaxed: false }), 'No puedes modificar el _id.');
    const result = await collection.replaceOne({ _id: { $eq: original._id }, $expr: { $eq: ['$$ROOT', { $literal: original }] } }, document, { maxTimeMS: 10000 });
    requireValue(Number(result.matchedCount) === 1, 'El documento cambió durante la edición. Actualiza e inténtalo nuevamente.', 409);
    log('replace', b, 'ok');
    res.json({ modifiedCount: Number(result.modifiedCount) });
  });
  app.delete('/api/documents', async (req, res) => {
    const b = req.body;
    const collection = await getCollection(b, true);
    const original = await originalDocument(collection, b);
    const result = await collection.deleteOne({ _id: { $eq: original._id }, $expr: { $eq: ['$$ROOT', { $literal: original }] } }, { maxTimeMS: 10000 });
    requireValue(Number(result.deletedCount) === 1, 'El documento cambió. Actualiza los resultados.', 409);
    log('delete', b, 'ok');
    res.json({ deletedCount: Number(result.deletedCount) });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Operación no encontrada.' }));
  app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof RequestError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El documento excede el límite de 2 MB de esta consola.' });
    if (err instanceof SyntaxError || err.name === 'BSONError' || err.name === 'BSONTypeError') return res.status(400).json({ error: 'JSON o Extended JSON inválido.' });
    // Mongo errors can contain URI credentials, server names or document values. Never echo them.
    const errors = { 11000: [409, 'Ya existe un documento con esa clave única.'], 13: [403, 'La credencial MongoDB no tiene permisos para esta operación.'], 18: [401, 'MongoDB rechazó las credenciales de la conexión.'], 50: [408, 'La consulta excedió el tiempo máximo. Acota el filtro o revisa sus índices.'], 2: [400, 'MongoDB rechazó la consulta. Revisa operadores, tipos y campos.'], 9: [400, 'MongoDB no pudo interpretar la consulta.'], 121: [400, 'El documento no cumple las reglas de validación de la colección.'] };
    const [status, message] = errors[err.code] || (err.name?.includes('ServerSelection') || err.name?.includes('Network') ? [503, 'No fue posible conectar. Revisa la VPN, DNS, firewall y URI en el servidor.'] : [500, 'No se pudo completar la operación MongoDB. Revisa la configuración y los permisos.']);
    res.status(status).json({ error: message });
  });
  return { app, close: async () => { await connectionQueue; await Promise.allSettled([...pools.values()].map(c => c.close())); pools.clear(); sessions.clear(); } };
}
