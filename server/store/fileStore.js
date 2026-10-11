import { mkdir, open, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createMemoryStore } from './memoryStore.js';

const mutations = new Set(['ensureUser', 'createClass', 'startLecture', 'updateLecture', 'addFlag', 'addTranscriptSegment', 'ensureLecture', 'resetClass', 'ready']);

/**
 * Small-demo store, sharing the memory/Postgres contract. One transaction reads the
 * latest snapshot, changes it, then atomically replaces it. mkdir is the exclusive
 * cross-process lock; appendFile alone would not provide locking.
 *
 * Prefer one host backend with a local folder. If using a mounted share, it must
 * support exclusive mkdir + atomic same-directory rename (not a cloud-sync folder).
 * A crashed process's lock is deliberately NOT stolen based on time alone.
 */
export function createFileStore(directory, { lockTimeoutMs = 5000 } = {}) {
    if (!directory?.trim()) throw new Error('SHARED_DATA_DIR must name a directory.');
    const folder = resolve(directory);
    const filename = join(folder, 'lockin-data.json');
    const lock = join(folder, '.lockin-write-lock');
    let pending = Promise.resolve();

    async function acquire() {
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const deadline = Date.now() + lockTimeoutMs;
        for (;;) {
            try { await mkdir(lock); return; }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                if (Date.now() >= deadline) throw new Error(`Shared storage is busy: ${lock}. If a server crashed, stop ALL backends using this folder before removing that lock directory.`);
                await sleep(25);
            }
        }
    }

    async function load() {
        try {
            const saved = JSON.parse(await readFile(filename, 'utf8'));
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid shared-file snapshot.');
            return saved;
        }
        catch (error) {
            if (error.code === 'ENOENT') return null;
            throw new Error(`Cannot read ${filename}. Existing data was not overwritten.`, { cause: error });
        }
    }

    async function save(snapshot) {
        const temp = join(folder, `.lockin-${crypto.randomUUID()}.tmp`);
        try {
            const handle = await open(temp, 'wx', 0o600);
            try { await handle.writeFile(JSON.stringify(snapshot), 'utf8'); await handle.sync(); }
            finally { await handle.close(); }
            await rename(temp, filename);
        } finally {
            await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        }
    }

    function transaction(method, args) {
        const work = pending.then(async () => {
            await acquire();
            try {
                const store = createMemoryStore(await load());
                const result = await store[method](...args);
                if (mutations.has(method)) await save(store.snapshot());
                return result;
            } finally { await rmdir(lock); }
        });
        pending = work.catch(() => {});
        return work;
    }

    return Object.fromEntries(Object.keys(createMemoryStore())
        .filter((method) => method !== 'snapshot')
        .map((method) => [method, (...args) => transaction(method, args)]));
}
