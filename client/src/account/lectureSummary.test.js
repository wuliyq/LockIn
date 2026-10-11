import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLectureSummary } from './lectureSummary.js'

const slides = [{ text: 'Gradient descent\nMove downhill.' }, { text: 'Learning rate' }, { text: 'Recap' }]

test('a flag on selected note text goes right under the line it came from', () => {
  const [section] = buildLectureSummary({
    slides,
    notes: { 0: 'Gradient points uphill.\nStep the opposite way.\nRepeat until it stops improving.' },
    flags: [{ id: 'f1', slide: 0, flagType: 'question', source: 'notes', selectedText: 'opposite way', studentComment: 'Why opposite?', aiAnswer: 'To lower the loss.', createdAt: '2026-10-10T14:00:00Z' }],
  })
  assert.equal(section.title, 'Gradient descent')
  assert.deepEqual(section.blocks.map((block) => [block.text, block.additions.map((a) => a.id)]), [
    ['Gradient points uphill.\nStep the opposite way.', ['f1']],
    ['Repeat until it stops improving.', []],
  ])
  assert.equal(section.blocks[0].additions[0].comment, 'Why opposite?')
  assert.equal(section.blocks[0].additions[0].quote, '', 'selection is already in the notes above')
})

test('slide flags, quick flags and catch-ups go after the slide notes, in time order', () => {
  const [section] = buildLectureSummary({
    slides,
    notes: { 1: 'Eta sets the step size.' },
    flags: [
      { id: 'late', slideNumber: 2, flagType: 'example', source: 'slide', selectedText: 'Learning rate', studentComment: '', timestamp: '2026-10-10T14:20:00Z' },
      { id: 'quick', slide: 1, flagType: 'confusing', source: 'slide', selectedText: '', studentComment: '', text: 'Confusing moment on slide 2', createdAt: '2026-10-10T14:05:00Z' },
    ],
    catchUps: [{ slide: 1, summary: ['- Big steps overshoot.'], timestamp: '2026-10-10T14:10:00Z' }],
  })
  assert.equal(section.blocks.length, 1)
  assert.deepEqual(section.blocks[0].additions.map((a) => a.id), ['quick', 'catch-up-0', 'late'])
  assert.equal(section.blocks[0].additions[0].comment, '')
  assert.deepEqual(section.blocks[0].additions[1].points, ['Big steps overshoot.'])
  assert.equal(section.blocks[0].additions[2].quote, '', 'slide-title fallback is not repeated')
})

test('slides with flags but no notes still appear, and empty slides are skipped', () => {
  const sections = buildLectureSummary({
    slides,
    notes: { 0: '  ', 2: 'Wrap-up.' },
    flags: [{ id: 'f', slide: 1, flagType: 'question', studentComment: 'What is eta?', selectedText: 'Highlighted area on slide 2' }],
  })
  assert.deepEqual(sections.map((s) => s.slide), [1, 2])
  assert.equal(sections[0].blocks[0].text, '')
  assert.equal(sections[0].blocks[0].additions[0].quote, '')
})

test('older saved flags with only `text` keep their question', () => {
  const [section] = buildLectureSummary({ notes: {}, flags: [{ id: 'old', slide: 0, flagType: 'confusing', selectedText: 'The gradient', text: 'Why uphill?' }] })
  assert.equal(section.blocks[0].additions[0].comment, 'Why uphill?')
  assert.equal(section.blocks[0].additions[0].quote, 'The gradient')
})
