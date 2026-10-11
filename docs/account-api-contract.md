# Shared login and lecture history — frontend handoff

The teammate owns the Postgres schema, migrations, authentication implementation, and Express routes. No database or server files were changed for this UI work. The routes below are **proposed and not yet implemented on this branch**.

The frontend adapter is `client/src/account/api.js`. It calls the same origin through Vite's `/api` proxy (default backend `http://localhost:3001`); `LOCKIN_API_PROXY` overrides the development/preview target. `VITE_API_URL` can set an explicit deployed API origin.

## Authentication

Use a server-managed HttpOnly session cookie. The frontend sends credentials with requests and never stores passwords or session tokens. Issue, expire, and revoke sessions on the backend; use Secure cookies with HTTPS in production. Derive the user's ID and role from the authenticated session, never a client-supplied user ID. Return errors as `{ "error": "Readable message" }` with an appropriate 4xx/5xx status.

`User` response shape:

```json
{"id":"user-uuid","name":"Alex Lee","email":"alex@example.edu","role":"student"}
```

| Method | Route | Request | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{name,email,password,role}`; role is `student` or `lecturer` | `{user}` and session cookie |
| POST | `/api/auth/login` | `{email,password}` | `{user}` and session cookie |
| GET | `/api/auth/me` | Session cookie | `{user}` or 401 |
| POST | `/api/auth/logout` | Session cookie | `{ok:true}`; revoke session and clear cookie |

Login has no role override: the stored account role determines which homepage opens. Registration currently presents both role choices; a lecturer account must only see classes it owns. The backend should validate inputs, hash passwords, and rate-limit authentication attempts. If you choose a hosted auth provider instead, replace this one adapter and the bootstrap in `AccountApp.jsx`.

## Lectures

| Method | Route | Request | Response |
|---|---|---|---|
| GET | `/api/lectures` | Authenticated user | `{lectures:[LectureSummary]}` newest first |
| POST | `/api/lectures` | `{title,classCode}`; optional class code, student only | `{lecture:{id,title,started_at}}` |
| GET | `/api/lectures/:id` | Authorized owner or associated lecturer | `{lecture:LectureDetail}` |
| PATCH | `/api/lectures/:id` | `{snapshot:LectureSnapshot}`; owner only | `{saved:true}` |
| POST | `/api/lectures/:id/finish` | `{snapshot:LectureSnapshot}`; owner only | `{saved:true}`; set ended_at server-side |

A new server-issued lecture ID is also the `sessionId` sent to existing flag, transcript, and catch-up routes. Create one new ID per lecture, not per browser. Associate a lecture with the signed-in student and, if a valid class code is provided, the corresponding lecturer's class. A blank class code means independent study. Reject unknown codes without creating a lecture.

```json
{
  "id":"lecture-uuid",
  "title":"Gradient descent",
  "class_title":"COMP 664",
  "student_name":"Alex Lee",
  "started_at":"2026-10-10T14:00:00.000Z",
  "ended_at":"2026-10-10T14:45:00.000Z",
  "filename":"lecture-12.pdf",
  "seconds":2700,
  "notePages":2,
  "flagCount":1
}
```

`ended_at` is null while in progress. `LectureDetail` includes summary fields plus `snapshot`, `flags`, and `catchUps`.

```json
{
  "filename":"lecture-12.pdf",
  "seconds":2700,
  "slides":[{"index":0,"text":"Gradient descent..."}],
  "notes":{"0":"My note for the first slide.","1":"My second note."},
  "flags":[{
    "id":"flag-uuid","sessionId":"lecture-uuid","filename":"lecture-12.pdf",
    "slide":0,"flagType":"confusing","source":"notes",
    "text":"Why move in the opposite direction?",
    "aiAnswer":"The gradient points toward increasing loss.",
    "createdAt":"2026-10-10T14:12:00.000Z"
  }],
  "catchUps":[{
    "id":"catchup-uuid","timestamp":"2026-10-10T14:20:00.000Z",
    "slide":0,"summary":["The gradient points toward increasing loss."]
  }]
}
```

Snapshot `slide` and note keys are **zero-based**. Existing server events use **one-based** `slideNumber`; the reviewer supports either. Prefer server flag/catch-up events as the authoritative dashboard data. Snapshot flags are a recovery copy: do not double-count them alongside server events. The client serializes debounced autosaves and waits for a final snapshot before marking the lecture finished. Return save errors so students can retry instead of silently losing work.

Store notes and extracted slide text for review. **Original PDF binaries are not uploaded/stored by this UI.** The history page labels the slides view as extracted text. If PDF storage is added later, extend the contract with an authorized download URL rather than embedding large PDFs in the snapshot. Validate and cap request sizes on the backend (suggested starting JSON body limit: 5 MB).

## Lecturer classes and permissions

| Method | Route | Request | Response |
|---|---|---|---|
| GET | `/api/classes` | Lecturer session | `{classes:[{id,title,code}]}` owned classes only |
| POST | `/api/classes` | `{title}`; lecturer only | `{classroom:{id,title,code}}` with a server-generated unique join code |

Students only list/read/change their own lectures. Lecturers list sessions for their own classes and read flags and catch-up timestamps. **Do not include students' private note snapshots or transcripts in lecturer responses**, even though the UI hides those tabs. A lecturer must not obtain arbitrary student records by guessing an ID. Protect the existing `/api/flags`, `/api/transcript`, `/api/catch-up`, `/api/confusion`, `/api/stt-token`, and `/api/dashboard/:sessionId` endpoints consistently.

## Preview and integration checks

The login page offers an explicit **UI preview** with fictional lectures for testing both roles. `previewApi.js` uses separate sessionStorage, never stores passwords, never calls the real AI/transcription API, and never automatically activates after a failed sign-in. It is not authentication or a Postgres substitute. The preview banner remains visible throughout the flow.

After implementing the API: test registration/sign-in for each role; expired cookie and logout; a student creating a lecture, saving notes, finishing, signing out and back in, and reopening the notes; a second student denied access to the first student's records; and a lecturer seeing only flags for their own class code. Check a failed save keeps the lecture open with a visible error. Old anonymous browser drafts are deliberately not auto-attached to the first account that signs in on a shared device.
