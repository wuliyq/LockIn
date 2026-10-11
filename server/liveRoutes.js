import { Router } from 'express';
import { addActivity, addFlag, getDashboardData } from './sessionStore.js';

export const liveRoutes = Router();
const eventTypes = new Set(['joined', 'session_started', 'session_finished', 'slides_loaded', 'slide_changed', 'notes_edited', 'highlighted', 'recording_started', 'recording_stopped', 'nudge_shown', 'nudge_dismissed']);
const flagTypes = new Set(['confusing', 'example', 'worked_example', 'real_world', 'check_thinking', 'why_it_matters', 'catch_up', 'question']);

function validate(body) {
  if (typeof body.sessionId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(body.sessionId)) throw new Error('A valid course code is required.');
  if (!Number.isInteger(body.slideNumber) || body.slideNumber < 1 || body.slideNumber > 2000) throw new Error('slideNumber must be between 1 and 2000.');
  for (const field of ['eventId', 'participantId']) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(body[field]))) throw new Error(`Invalid ${field}.`);
  }
}

liveRoutes.post('/activity', (req, res) => {
  try {
    validate(req.body);
    if (!eventTypes.has(req.body.type)) throw new Error('Unknown activity type.');
    // Never copy notes, names, email, transcript, or arbitrary metadata.
    const { sessionId, eventId, participantId, type, slideNumber } = req.body;
    const event = addActivity(sessionId, { eventId, participantId, type, slideNumber });
    res.status(201).json({ event: { id: event.id } });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

liveRoutes.post('/flags', (req, res) => {
  try {
    validate(req.body);
    const { sessionId, eventId, participantId, slideNumber, flagType, timestamp } = req.body;
    if (!flagTypes.has(flagType)) throw new Error('Unknown flag type.');
    const text = (key) => typeof req.body[key] === 'string' ? req.body[key].slice(0, 4000) : '';
    const when = Date.parse(timestamp);
    const flag = addFlag(sessionId, {
      eventId, participantId, slideNumber, flagType,
      selectedText: text('selectedText'), studentComment: text('studentComment'),
      // Raw text is used only by the server's existing AI insights route.
      source: ['notes', 'slide', 'transcript'].includes(req.body.source) ? req.body.source : 'slide',
      ...(Number.isFinite(when) && Math.abs(Date.now() - when) < 86400000 ? { timestamp: new Date(when).toISOString() } : {}),
    });
    res.status(201).json({ flag: { id: flag.id } });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

liveRoutes.get('/dashboard/:sessionId', (req, res) => res.json(getDashboardData(req.params.sessionId)));
