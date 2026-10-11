# LockIN 🔒

> A study helper for both students and lecturers

LockIN helps students stay in the lecture instead of quietly falling behind. Upload slides, take notes beside them, flag the confusing bit, and get a short AI explanation without leaving the page. Afterward, the lecture is saved as a reviewable summary. Lecturers get a dashboard that turns those anonymous flags into useful feedback.

## What you can do

### Student view

- Upload a PDF slide deck and move through it alongside your notes.
- Highlight part of a slide or select text in your notes, then flag it as:
  - **Confusing**
  - **Real-world example**
  - **Worked example**
  - **Check my thinking**
- Ask the focus buddy for a quick example, a check-in, why something matters, or a **Catch me up** summary.
- Record lecture audio in the background with ElevenLabs transcription.
- Get gentle focus nudges after a quiet stretch of time.
- Finish the lecture and come back to a clean summary of your notes, flags, AI answers, and catch-ups.

### Lecturer view

- Open the lecturer dashboard from the role picker, or directly with `?view=lecturer`.
- See which kinds of questions students are flagging most often.
- Explore when flags happened during a lecture and which slides need another look.
- Load the sample lecture for a fast demo.
- Ask Gemini for anonymous themes and suggestions for the next lecture.

## Quick start

You need a recent Node.js version, plus Gemini API key and Elevenlabs API for live recording.

```bash
git clone https://github.com/wuliyq/LockIn.git
cd LockIn
npm install
cd client && npm install
cd ..
cp .env.example .env
```

Open `.env` and add your key:

```env
GEMINI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
```

Then use two terminals.

```bash
# Terminal 1 — from the project root
npm run dev
```

```bash
# Terminal 2 — from the project root
cd client
npm run dev
```

Open the Vite address printed in Terminal 2 (usually `http://localhost:5173`). The frontend proxies `/api` calls to the Express server on port `3001`.

## Share a lecture across laptops without a database

Pick one teammate's laptop as the host. Everyone—including the lecturer—opens that host's **network address**, not their own localhost. Student actions and the dashboard then use the same backend.

On the host, add these lines to the project-root `.env`:

```env
SHARED_DATA_DIR=./shared_logs
MIN_STUDENTS=1
```

Start the backend from the project root with `npm run dev`. Its startup message should say **file store**. In a second terminal, also from the project root:

```bash
npm --prefix client run dev -- --host 0.0.0.0
```

Open the Network URL Vite prints, for example `http://192.168.1.50:5173` (use the host's actual IP and port). Leave `VITE_API_URL` unset on the frontend so `/api` goes through that host's proxy. If it was set to localhost, remove that setting and restart Vite; rebuild if serving a production build.

1. The lecturer creates a class using the existing **Create class** form, then opens its dashboard.
2. Students open the same host website, enter that class code in the existing field, and start a **new** lecture. A blank code creates independent study, which won't appear in the class dashboard.
3. Upload the same PDF on each laptop so slide numbers match. Flag a slide or note, and wait for the dashboard's next refresh. Existing AI requests can delay flag submission.

The host creates `shared_logs/lockin-data.json` automatically. It stores classes, student sessions, flags, snapshots and transcript segments, and survives server restarts. This folder is ignored by Git. `SHARED_DATA_DIR` takes precedence over Postgres and `USE_MEMORY`; leaving it blank preserves the existing selection. Switching stores does **not** migrate old data—create a fresh demo class after switching.

Only the backend reads/writes the file. Students do **not** need to mount a shared folder, and the raw file should never be publicly served: it contains private notes/transcripts and optional names. Existing dashboard filtering remains unchanged. `MIN_STUDENTS=1` shows one student's reactions for a demo; `3` enables the existing small-group privacy threshold. The app remains a demo, not a secure authenticated classroom service.

### If you deliberately run multiple backends

Point `SHARED_DATA_DIR` on each backend to the **same actual mounted directory**, not separate folders with the same name. Restrict access to the trusted backend users, rather than granting everyone write access. The file store reloads before every operation, serializes changes with an exclusive directory lock, and replaces the JSON file using a unique temporary file. Shared filesystems must support exclusive directory creation and atomic rename within the directory. Concurrent processes on one filesystem are tested; your SMB configuration still needs a real two-laptop check. Do not use a cloud-synced folder for this.

A crashed process may leave `.lockin-write-lock` behind. If requests report that storage is busy, first stop **all** backends using the folder. Only then remove that empty lock directory and restart. Never delete the data file to fix a lock. A corrupt/unreadable data file causes an error instead of silently resetting the class.

For this hackathon, one host backend is simpler. This adapter rewrites a small JSON snapshot per change; use Postgres for larger classes or production. Browser recording on another laptop's plain HTTP address still needs an HTTPS setup; reactions and notes can use LAN HTTP.

File-store checks, without PostgreSQL or paid AI calls:

```bash
node --test server/store/fileStore.test.js
```

## Tech we used

- **React + Vite** for the interface
- **Express** for the local API server
- **Google Gemini** for concise explanations, catch-ups, and lecturer insights
- **ElevenLabs Scribe** for live speech-to-text
- **PDF.js** for rendering and reading slide decks
- **PostgreSQL store groundwork** is included under `server/store/` and `server/db/`

## Useful commands

```bash
# Build the frontend
cd client && npm run build

# Run the frontend checks
cd client && npm run lint

# Run server-store tests (requires local PostgreSQL for the test database)
npm test
```

## Project map

```text
client/src/
  account/     entry screen, lecture home, and saved-lecture review
  lecturer/    lecturer dashboard, charts, and AI suggestions
  lockin/      notes, flags, focus nudges, and speech-to-text state
    stt.js      ElevenLabs realtime transcription client
  slides/      PDF loading, rendering, and slide-text extraction
server/
  index.js     Express routes
  gemini.js    Gemini calls
  prompts.js   short, lecture-aware AI prompts
```

Built at HackNC 2026. Have a question, flag it — that is what LockIN is for. ✨
