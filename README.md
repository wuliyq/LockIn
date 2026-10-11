# LockIN 🔒

> A little study buddy for the moments when a lecture loses you.

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
