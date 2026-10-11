import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rmdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createFileStore } from './fileStore.js';

async function folderFor(t) {
    const folder = await mkdtemp(join(tmpdir(), 'lockin-file-test-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    return folder;
}

test('file store persists class, lecture, flags, private snapshot and transcript across instances', async (t) => {
    const folder = await folderFor(t);
    const host = createFileStore(folder);
    await host.ready();
    const lecturerId = crypto.randomUUID();
    await host.createClass({ lecturerId, title: 'Test class', code: 'SHARED' });
    const lecture = await host.startLecture({ studentId: crypto.randomUUID(), classCode: 'shared' });
    await host.addFlag(lecture.id, { type: 'confusing', slideIndex: 0, studentText: 'PRIVATE-QUESTION' });
    await host.updateLecture(lecture.id, { snapshot: { notes: { 0: 'PRIVATE-NOTE' } } });
    await host.addTranscriptSegment(lecture.id, { slideIndex: 0, text: 'PRIVATE-TRANSCRIPT' });
    const restarted = createFileStore(folder);
    await restarted.ready();
    assert.equal((await restarted.listClasses(lecturerId)).length, 1);
    assert.equal((await restarted.getLecture(lecture.id)).snapshot.notes[0], 'PRIVATE-NOTE');
    assert.equal(await restarted.getRecentTranscript(lecture.id, 0), 'PRIVATE-TRANSCRIPT');
    const flags = await restarted.dashboardFlags('SHARED');
    assert.equal(flags.length, 1);
    assert.ok(!JSON.stringify(flags).includes('PRIVATE'));
    assert.equal((await restarted.dashboardFlags('OTHER')).length, 0);
    const saved = JSON.parse(await readFile(join(folder, 'lockin-data.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.flags.length, 1);
});

test('parallel store instances reload the file without lost updates or duplicate IDs', async (t) => {
    const folder = await folderFor(t);
    const a = createFileStore(folder), b = createFileStore(folder);
    const lecture = await a.ensureLecture({ studentId: crypto.randomUUID(), classCode: 'CONCURRENT' });
    await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).addFlag(lecture.id, { type: 'catch_up', slideIndex: 0 })));
    const flags = await a.lectureFlags(lecture.id);
    assert.equal(flags.length, 30);
    assert.equal(new Set(flags.map((f) => f.id)).size, 30);
    await assert.rejects(a.addFlag(lecture.id, { type: 'INVALID' }));
    assert.equal((await b.lectureFlags(lecture.id)).length, 30);
});

test('corrupt data and lingering locks fail safely instead of clearing data', async (t) => {
    const folder = await folderFor(t);
    const file = join(folder, 'lockin-data.json');
    const store = createFileStore(folder, { lockTimeoutMs: 60 });
    for (const content of ['broken json', 'null', '{"version":999}']) {
        await writeFile(file, content);
        await assert.rejects(store.ready());
        assert.equal(await readFile(file, 'utf8'), content);
    }
    const lock = join(folder, '.lockin-write-lock');
    await mkdir(lock);
    await assert.rejects(store.ready(), /Shared storage is busy/);
    await rmdir(lock);
});

async function startBackend(t, folder) {
    const child = spawn(process.execPath, ['server/index.js'], {
        cwd: new URL('../../', import.meta.url),
        env: { ...process.env, PORT: '0', SHARED_DATA_DIR: folder, GEMINI_API_KEY: 'unused-test-key', MIN_STUDENTS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        child.once('exit', resolve); child.kill('SIGTERM');
    }));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 10000);
        let output = '';
        child.stdout.on('data', (data) => {
            output += data;
            const match = output.match(/http:\/\/localhost:(\d+) \(file store\)/);
            if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
        });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Backend exited: ${code}`)); });
    });
}

test('two backend processes share class and student flags; restart retains them', async (t) => {
    const folder = await folderFor(t);
    const host = await startBackend(t, folder);
    const other = await startBackend(t, folder);
    async function client(base) {
        const session = await fetch(`${base}/api/session`, { method: 'POST' });
        const cookie = session.headers.get('set-cookie').split(';')[0];
        return async (path, body) => {
            const response = await fetch(`${base}${path}`, {
                method: body ? 'POST' : 'GET',
                headers: { Cookie: cookie, 'Content-Type': 'application/json' },
                ...(body && { body: JSON.stringify(body) }),
            });
            const data = await response.json();
            assert.ok(response.ok, JSON.stringify(data));
            return data;
        };
    }
    const teacher = await client(host), alice = await client(other), bob = await client(host);
    const { classroom } = await teacher('/api/classes', { title: 'LAN integration test' });
    const [a, b] = await Promise.all([alice('/api/lectures', { classCode: classroom.code }), bob('/api/lectures', { classCode: classroom.code })]);
    await Promise.all([
        alice('/api/flags', { sessionId: a.lecture.id, slideNumber: 1, flagType: 'confusing', selectedText: 'PRIVATE-HIGHLIGHT' }),
        bob('/api/flags', { sessionId: b.lecture.id, slideNumber: 2, flagType: 'catch_up' }),
    ]);
    const dashboard = await teacher(`/api/dashboard/${classroom.code}`);
    assert.equal(dashboard.totalFlags, 2);
    assert.deepEqual(dashboard.flagsByType, { confusing: 1, catch_up: 1 });
    assert.ok(!JSON.stringify(dashboard).includes('PRIVATE'));
    assert.equal((await teacher('/api/teaching/lectures')).lectures.length, 2);
    const freshProcess = await startBackend(t, folder);
    const read = await client(freshProcess);
    assert.equal((await read(`/api/dashboard/${classroom.code}`)).totalFlags, 2);
});
