# LockIN 🔒

> Lost the thread? Flag it. Let's get you back into the lecture.

LockIN helps students follow along, ask questions, and keep their notes in one place. Students get a little help when something doesn't click. Lecturers get a clearer picture of where the class needs support.

Built at **HackNC 2026**.

## For students 🎒

- **Slides and notes, side by side.** Upload a PDF, take slide-linked notes, and resize the panels to suit you.
- **Flag the confusing bit.** Select text in your notes or highlight an area of a slide, then choose:
  - Confusing
  - Give an example
  - Why it matters
  - Check my thinking
- **Ask the focus buddy.** Get a short AI explanation using the slide, your notes, and recent transcript context.
- **Catch me up.** Use the separate catch-up button beside the recording control to summarise the latest recorded part of the lecture.
- **A gentle nudge.** Turn focus reminders on or off and choose how long to wait between quiet stretches.
- **Come back later.** Finish a lecture to save its notes, flags, answers, and catch-up summaries for review.

## For lecturers 📊

- Create classes and share a class code with students.
- See student sessions linked to your classes.
- Explore reactions by type, slide, and time in the live dashboard.
- Review students' flagged questions, AI answers, and catch-up timestamps.
- Ask Gemini for question themes and suggestions for future lectures.

The dashboard refreshes roughly every five seconds while its tab is visible. Flags currently send after the AI explanation attempt finishes; catch-up flags send after a summary is generated.

## How it fits together

Students join a class when they start a lecture. Each student has their own lecture session, while the lecturer's dashboard collects flags across that class.

Notes are saved locally while writing. Finishing the lecture saves a reviewable snapshot to the backend. Flags and transcript segments are stored during the lecture.

The backend supports three storage modes:

| Storage | Configuration | Survives a restart? |
| --- | --- | --- |
| Shared JSON file | Set `SHARED_DATA_DIR` | Yes |
| In memory | Leave `SHARED_DATA_DIR` blank and set `USE_MEMORY=1` | No |
| PostgreSQL | Leave `SHARED_DATA_DIR` blank and `USE_MEMORY` unset; configure `DATABASE_URL` | Yes |

File storage takes priority when configured. It writes to `lockin-data.json` inside the chosen folder, using locking and atomic file replacement to protect concurrent updates. Switching storage modes does not copy existing data between them.

## Tech stack

- **React + Vite** — student workspace and lecturer dashboard
- **Express + Node.js** — API, classes, sessions, and lecture history
- **Google Gemini** — explanations, catch-up summaries, and lecturer insights
- **ElevenLabs Scribe** — live speech-to-text
- **PDF.js** — slide rendering and text extraction
- **PostgreSQL or shared JSON storage** — saved lecture data

## Getting started

You'll need **Node.js 22.13 or newer**, npm, a **Gemini API key**, and an **ElevenLabs API key**.

```bash
git clone https://github.com/wuliyq/LockIn.git
cd LockIn
npm install
npm --prefix client install
cp .env.example .env
```

Add your keys to the project-root `.env`. This setup uses file storage:

```env
GEMINI_API_KEY=your_gemini_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
SHARED_DATA_DIR=./shared_logs
PORT=3001
```

Start the backend from the project root:

```bash
npm run dev
```

In a second terminal, also from the project root:

```bash
npm --prefix client run dev
```

Open the address Vite prints, usually `http://localhost:5173`. Vite forwards `/api` requests to the backend on port `3001`. Keep `VITE_API_URL` unset when using this setup so both student and lecturer views use the same backend.

Microphone access requires browser permission and HTTPS or localhost. Keep API keys on the server; never put them in frontend `VITE_` variables.

## A note on privacy

The entry screen is a role picker, not real authentication. Browser identity is kept in a cookie, so using a different browser or hostname can show a different lecture history.

Dashboard charts omit student names and raw question text. The lecturer's separate session-detail view can show entered display names, flagged text, and AI answers; it does not return students' full notes or transcripts. `MIN_STUDENTS` controls the minimum number of distinct students needed for a dashboard group to appear; it defaults to `1`.

Saved storage can contain private notes and transcripts. Keep it out of public folders and version control. Audio is sent to ElevenLabs for transcription, and relevant lecture context is sent to Gemini for AI features. LockIN still needs stronger access controls before use with sensitive student data.

## Development commands

Run these from the project root:

```bash
# Build the frontend
npm --prefix client run build

# Check frontend code
npm --prefix client run lint

# Test shared-file storage, including concurrent backend processes
node --test server/store/fileStore.test.js

# Test lecture summaries and the preview adapter
node --test client/src/account/lectureSummary.test.js client/src/account/previewApi.test.js
```

`npm start` runs the API only. It does not serve the built frontend.

## Project map

```text
client/src/
  account/     role picker, class management, lecture history, and review
  lecturer/    dashboard, charts, and lecturer insights
  lockin/      notes, flags, focus reminders, and transcription
  slides/      PDF loading, rendering, and text extraction
server/
  index.js     API routes
  gemini.js    Gemini requests
  prompts.js   lecture-aware AI prompts
  insights.js  lecturer insight processing
  store/       PostgreSQL, memory, and file-storage adapters
  db/          PostgreSQL schema
```

One confusing moment shouldn't cost you the rest of the lecture. LockIN and keep going. 🌱
