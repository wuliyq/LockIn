import test from 'node:test'
import assert from 'node:assert/strict'
import { cityReducer, INITIAL_CITY, restoreCity, rewardKey } from './cityState.js'

test('a new city can build a park, but cannot buy it twice', () => {
  const built = cityReducer(INITIAL_CITY, { type: 'build', building: 'garden', id: '1' })
  assert.equal(built.coins, 5)
  assert.deepEqual(built.built, ['home', 'garden'])
  assert.equal(cityReducer(built, { type: 'build', building: 'garden' }), built)
})

test('expensive or unknown buildings cannot spend coins', () => {
  for (const building of ['hall', 'missing']) {
    assert.equal(cityReducer(INITIAL_CITY, { type: 'build', building }), INITIAL_CITY)
  }
})

test('notes earn rewards once per slide, including repeated edits', () => {
  const action = { type: 'reward', kind: 'note', deckKey: 'Lecture.pdf', slide: 0, id: '1' }
  const earned = cityReducer(INITIAL_CITY, action)
  assert.equal(earned.coins, 45)
  assert.equal(earned.xp, 20)
  assert.equal(cityReducer(earned, action), earned)
  assert.equal(cityReducer(earned, { ...action, slide: 1 }).xp, 40)
})

test('reloading a PDF or changing its slide cannot farm the upload reward', () => {
  const action = { type: 'reward', kind: 'deck', deckKey: 'Lecture.pdf', slide: 0 }
  const earned = cityReducer(INITIAL_CITY, action)
  assert.equal(cityReducer(earned, { ...action, slide: 4 }), earned)
  assert.equal(cityReducer(earned, { ...action, deckKey: 'Other.pdf' }).xp, 30)
})

test('progress survives saving, and a spent reward stays claimed', () => {
  const earned = cityReducer(INITIAL_CITY, { type: 'reward', kind: 'flag', deckKey: 'Lecture.pdf', slide: 2, id: '1' })
  const built = cityReducer(earned, { type: 'build', building: 'cafe', id: '2' })
  const restored = restoreCity(JSON.stringify(built))
  assert.equal(restored.coins, 5)
  assert.equal(restored.xp, 15)
  assert.ok(restored.built.includes('cafe'))
  assert.ok(restored.rewards[rewardKey('flag', 'Lecture.pdf', 2)])
  assert.equal(restored.notice, null)
})

test('invalid stored data falls back safely; valid city preferences persist', () => {
  for (const raw of ['not json', 'null', '{"coins":-1}', JSON.stringify({ ...INITIAL_CITY, built: null })]) {
    assert.equal(restoreCity(raw), INITIAL_CITY)
  }
  const quiet = cityReducer(INITIAL_CITY, { type: 'quiet' })
  const night = cityReducer(quiet, { type: 'night' })
  assert.equal(restoreCity(JSON.stringify(night)).quiet, true)
  assert.equal(restoreCity(JSON.stringify(night)).night, true)
})

test('no coins are granted for unknown actions or notes without a deck', () => {
  assert.equal(cityReducer(INITIAL_CITY, { type: 'reward', kind: 'note', deckKey: '', slide: 0 }), INITIAL_CITY)
  assert.equal(cityReducer(INITIAL_CITY, { type: 'reward', kind: 'invented', deckKey: 'Lecture.pdf' }), INITIAL_CITY)
})
