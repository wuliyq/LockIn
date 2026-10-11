import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { liveRoutes } from './liveRoutes.js';
import { addTranscriptSegment, getRecentTranscript } from './sessionStore.js';

test('two students share a course; retries deduplicate; the dashboard contains no private data', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api', liveRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const course = `TEST-${crypto.randomUUID()}`;
  const post = async (path, body, expected = 201) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, expected);
    return response.json();
  };
  const dashboard = (code = course) => fetch(`${base}/dashboard/${code}`).then((r) => r.json());
  const alice = { sessionId: course, participantId: 'random-browser-one', slideNumber: 2 };
  const bob = { sessionId: course.toLowerCase(), participantId: 'random-browser-two', slideNumber: 3 };
  await Promise.all([
    post('/activity', { ...alice, type: 'joined', eventId: 'join-one', name: 'PRIVATE-NAME', notes: 'PRIVATE-NOTE' }),
    post('/activity', { ...bob, type: 'joined', eventId: 'join-two' }),
  ]);
  const flag = { ...alice, flagType: 'confusing', eventId: 'flag-one', source: 'notes', selectedText: 'PRIVATE-SELECTED-TEXT', studentComment: 'PRIVATE-COMMENT', aiAnswer: 'PRIVATE-ANSWER', timestamp: new Date().toISOString() };
  const saved = await post('/flags', flag);
  const retry = await post('/flags', flag);
  assert.deepEqual(retry, saved);
  await post('/flags', { ...bob, flagType: 'catch_up', eventId: 'flag-two', source: 'transcript' });
  await post('/activity', { ...bob, type: 'notes_edited', eventId: 'edit-one', transcript: 'PRIVATE-TRANSCRIPT' });
  await post('/activity', { ...bob, type: 'notes_edited', eventId: 'edit-one' });
  await post('/flags', { ...alice, sessionId: `${course}-OTHER`, flagType: 'example', eventId: 'flag-one' });
  const data = await dashboard();
  assert.equal(data.sessionId, course.toUpperCase());
  assert.equal(data.totalFlags, 2);
  assert.deepEqual(data.flagsByType, { confusing: 1, catch_up: 1 });
  assert.equal(data.participantCount, 2);
  assert.equal(data.eventCount, 5);
  assert.equal(data.activityCounts.notes_edited, 1);
  assert.equal(data.flags[0].hasQuestion, true);
  assert.equal(data.flags[0].timestamp, flag.timestamp);
  assert.equal((await dashboard(`${course}-OTHER`)).totalFlags, 1);
  assert.equal((await dashboard(`${course}-EMPTY`)).totalFlags, 0);
  const wire = JSON.stringify(data);
  for (const forbidden of ['PRIVATE-', 'random-browser-one', 'random-browser-two', 'participantId', 'selectedText', 'studentComment', 'aiAnswer']) assert.ok(!wire.includes(forbidden), forbidden);
  for (const flagType of ['example', 'why_it_matters', 'check_thinking']) await post('/flags', { ...alice, flagType, eventId: flagType.replaceAll('_', '-') });
  assert.equal((await dashboard()).totalFlags, 5);
  await post('/flags', { ...alice, flagType: 'not-a-type' }, 400);
  await post('/flags', { ...flag, slideNumber: 0 }, 400);
  await post('/activity', { ...alice, type: 'arbitrary-event' }, 400);
  await post('/activity', { ...alice, type: 'joined', sessionId: '../bad' }, 400);
});

test('catch-up transcript windows are isolated by participant, slide, and course', () => {
  const sessionId = crypto.randomUUID();
  addTranscriptSegment(sessionId, { participantId: 'one', slideNumber: 1, text: 'One on slide one.' });
  addTranscriptSegment(sessionId, { participantId: 'two', slideNumber: 1, text: 'Two private recording.' });
  addTranscriptSegment(sessionId, { participantId: 'one', slideNumber: 2, text: 'Different slide.' });
  assert.equal(getRecentTranscript(sessionId, 1, 4, 'one'), 'One on slide one.');
  assert.equal(getRecentTranscript(sessionId, 1, 4, 'two'), 'Two private recording.');
  assert.equal(getRecentTranscript(sessionId, 1), '');
  assert.equal(getRecentTranscript(`${sessionId}-OTHER`, 1, 4, 'one'), '');
});
