import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';

export function defaultDataDirectory(env = process.env) {
  return env.SCOTIA_DATA_DIR || path.join(env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'ScotiaCompass');
}

// The catalog and its key are server-local, outside the source tree by default.
// Back up both files together. The server account must be the only account with access.
export function createConnectionStore(directory = defaultDataDirectory()) {
  const catalogPath = path.join(directory, 'connections.enc');
  const keyPath = path.join(directory, 'connections.key');
  let queue = Promise.resolve();
  async function key(create = false) {
    try { const bytes = await readFile(keyPath); if (bytes.length !== 32) throw new Error('Invalid key'); return bytes; }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      const bytes = randomBytes(32);
      try { await writeFile(keyPath, bytes, { flag: 'wx', mode: 0o600 }); return bytes; }
      catch (error) { if (error.code !== 'EEXIST') throw error; return key(); }
    }
  }
  return {
    async load() {
      let encrypted;
      try { encrypted = await readFile(catalogPath); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      try {
        if (encrypted[0] !== 1 || encrypted.length < 30) throw new Error('Invalid catalog');
        const decipher = createDecipheriv('aes-256-gcm', await key(), encrypted.subarray(1, 13));
        decipher.setAuthTag(encrypted.subarray(13, 29));
        const entries = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]).toString('utf8'));
        if (!Array.isArray(entries)) throw new Error('Invalid catalog');
        return entries;
      } catch { throw new Error('No se pudieron descifrar las conexiones guardadas. Revisa el catálogo y su clave; no se han sobrescrito.'); }
    },
    save(entries) {
      const snapshot = JSON.stringify(entries);
      const task = queue.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', await key(true), iv);
        const ciphertext = Buffer.concat([cipher.update(snapshot, 'utf8'), cipher.final()]);
        const payload = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
        const temporary = path.join(directory, `${randomUUID()}.tmp`);
        try { await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 }); await rename(temporary, catalogPath); }
        finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      });
      queue = task.catch(() => {});
      return task;
    }
  };
}
