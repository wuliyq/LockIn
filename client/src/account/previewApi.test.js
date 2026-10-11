import test from 'node:test'
import assert from 'node:assert/strict'
import { previewApi, previewLecturerApi } from './previewApi.js'

test('preview lecture saves and reopens the same notes, flags, and slide text', async () => {
  const { lecture } = await previewApi.createLecture({ title: 'Round-trip check' })
  const snapshot = { filename: 'test.pdf', notes: { 0: 'A saved note.' }, slides: [{ index: 0, text: 'Slide text' }], flags: [], catchUps: [], seconds: 60 }
  await previewApi.saveLecture(lecture.id, snapshot)
  await previewApi.finishLecture(lecture.id, snapshot)
  const history = (await previewApi.listLectures()).lectures.find((item) => item.id === lecture.id)
  assert.equal(history.notePages, 1)
  assert.ok(history.ended_at)
  assert.deepEqual((await previewApi.getLecture(lecture.id)).lecture.snapshot, snapshot)
})

test('lecturer preview excludes independent sessions and returns no private notes', async () => {
  const independent = (await previewApi.createLecture({ title: 'Independent study' })).lecture
  assert.ok(!(await previewLecturerApi.listLectures()).lectures.some((item) => item.id === independent.id))
  await assert.rejects(() => previewLecturerApi.getLecture(independent.id))
  const joined = (await previewApi.createLecture({ title: 'Joined class', classCode: 'PREVIEW' })).lecture
  await previewApi.saveLecture(joined.id, { notes: { 0: 'Private student note' }, flags: [{ id: 'flag', text: 'A shared question' }] })
  assert.ok((await previewLecturerApi.listLectures()).lectures.some((item) => item.id === joined.id))
  const detail = (await previewLecturerApi.getLecture(joined.id)).lecture
  assert.equal(detail.snapshot, undefined)
  assert.equal(detail.flags[0].text, 'A shared question')
})

test('invalid class code cannot create a preview lecture', async () => {
  const before = (await previewApi.listLectures()).lectures.length
  await assert.rejects(() => previewApi.createLecture({ title: 'Invalid code', classCode: 'DOESNOTEXIST' }))
  assert.equal((await previewApi.listLectures()).lectures.length, before)
})
