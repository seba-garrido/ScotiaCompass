import { Query } from 'mingo';
import { EJSON, ObjectId } from 'bson';

export function loadDemoConnections() {
  try {
    const entries = JSON.parse(localStorage.getItem('scotia-demo-connections-v2') || '[]');
    return Array.isArray(entries) ? entries.filter(c => typeof c.id === 'string' && typeof c.name === 'string' && ['Atlas', 'Anthos'].includes(c.provider) && ['IST', 'UAT', 'PROD'].includes(c.environment)).map(c => ({ ...c, status: 'disconnected' })) : [];
  } catch { return []; }
}
export function saveDemoConnections(entries) {
  // Only fictional profile metadata is saved. This format never includes a URI.
  localStorage.setItem('scotia-demo-connections-v2', JSON.stringify(entries.map(({ id, name, provider, environment, database, readOnly, color }) => ({ id, name, provider, environment, database, readOnly, color }))));
}
const data = new Map();
const encode = x => EJSON.serialize(x, { relaxed: false });
const decode = x => EJSON.deserialize(x, { relaxed: true });
export const demoDatabases = () => ['db_eventlog', 'db_operaciones'];
export const demoCollections = database => database === 'db_eventlog' ? ['EventLog', 'EventTypes', 'ApplicationConfig'] : ['Transactions', 'Channels'];
function documents(connection, database, collection) {
  const key = `${connection}:${database}:${collection}`;
  if (!data.has(key)) {
    const types = ['TICKET_CREATED', 'TICKET_UPDATED', 'DOCUMENT_VALIDATED', 'PROCESS_COMPLETED', 'TICKET_REJECTED'];
    const generated = Array.from({ length: collection === 'EventLog' ? (connection.startsWith('anthos') ? 160 : 128) : 8 }, (_, i) => collection === 'EventLog' ? {
      _id: new ObjectId((0x69150000 + i).toString(16) + 'a8f2d604b710' + i.toString(16).padStart(4, '0')),
      eventType: types[i % types.length],
      status: i % 9 === 8 ? 'ERROR' : i % 7 === 6 ? 'PENDING' : 'SUCCESS',
      created_at: new Date(Date.now() - i * 384000),
      processId: `PROC-${String(20481 + i).padStart(6, '0')}`,
      country: ['CL', 'UY', 'PE', 'CL'][i % 4],
      channel: ['WEB', 'MOBILE', 'BRANCH'][i % 3],
      eventData: { ticketId: `TK-${87040 + i}`, operation: 'CREATE', source: 'eventlog-service', version: 1 }
    } : { _id: new ObjectId(), name: `${collection === 'EventTypes' ? types[i % 5] : collection} ${i + 1}`, enabled: true, updated_at: new Date(Date.now() - i * 3600000) });
    data.set(key, generated);
  }
  return data.get(key);
}
export async function demoQuery(b) {
  const started = performance.now();
  const source = documents(b.connection, b.database, b.collection);
  const filter = decode(b.filter);
  const cursor = new Query(filter, { scriptEnabled: false }).find(source, b.projection).sort(b.sort).skip(b.skip).limit(b.limit + 1);
  const result = cursor.all();
  return { documents: result.slice(0, b.limit).map(encode), revisions: result.slice(0, b.limit).map(x => EJSON.stringify(x)), hasMore: result.length > b.limit, duration: Math.max(1, Math.round(performance.now() - started)), estimatedCount: source.length, skip: b.skip, limit: b.limit };
}
export function demoWrite(action, b) {
  const source = documents(b.connection, b.database, b.collection);
  if (action === 'insert') {
    const document = decode(b.document);
    document._id ??= new ObjectId();
    if (source.some(d => EJSON.stringify(d._id) === EJSON.stringify(document._id))) throw new Error('Ya existe un documento con ese _id.');
    source.unshift(document);
    return;
  }
  const index = source.findIndex(d => EJSON.stringify(encode(d._id)) === EJSON.stringify(b.id));
  if (index < 0) throw new Error('No se encontró el documento.');
  if (action === 'delete') source.splice(index, 1);
  else {
    const document = decode(b.document);
    if (EJSON.stringify(document._id) !== EJSON.stringify(source[index]._id)) throw new Error('No puedes cambiar el _id.');
    source[index] = document;
  }
}
export function demoIndexes(collection) {
  return [{ name: '_id_', key: { _id: 1 }, unique: true }, ...(collection === 'EventLog' ? [{ name: 'created_at_-1', key: { created_at: -1 } }, { name: 'eventType_1_status_1', key: { eventType: 1, status: 1 } }] : [])];
}
