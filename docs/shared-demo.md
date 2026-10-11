# One lecture, several laptops 🔒

The student and lecturer screens keep their existing design. Everyone opens the **same server address** and **same lecture code**. No real accounts are required.

## Fastest setup: one host laptop

From the project root:

```bash
npm install
npm --prefix client install
npm --prefix client run build
npm start
```

This serves both the built website and API on port `3001`. Keep that terminal and laptop running. For frontend development you can still use Vite; its `/api` proxy points to the same backend.

1. Connect the laptops to the same trusted Wi-Fi. Find the host's local IP in network settings.
2. On the lecturer laptop, open `http://HOST-IP:3001/?view=lecturer&lecture=HACKNC-DEMO` (replace `HOST-IP`). Use that network address even on the host so copied links work on other laptops.
3. Click the existing **Copy student link** button. Students open it, choose Student in the existing entry screen, and click **New lecture**.
4. Upload the same PDF on each laptop so slide numbers refer to the same material. PDFs are not automatically shared.
5. Press **Confusing**, **Give an example**, **Why it matters**, **Check my thinking**, or **Catch me up**. The existing lecturer charts update approximately every two seconds while that tab is visible.

Flags are sent before the AI answers. Even an unsuccessful catch-up request counts as a request. Gemini/ElevenLabs keys are needed for their features, **not** for shared flags and charts.

If a student already has a different lecture open, finish it before opening the new course link. Use a fresh lecture code for each lecture; use **Load sample lecture** only when you intentionally want sample data.

### Microphone and Wi-Fi gotchas

- Browser microphone access needs HTTPS or localhost. On another laptop's plain `http://HOST-IP` address, notes and reactions work but recording does not. Use one shared HTTPS deployment or an HTTPS tunnel for a recording demo.
- Campus/guest Wi-Fi may prevent devices from reaching each other. A trusted hotspot or shared HTTPS address avoids that limitation.
- Leave `VITE_API_URL` unset for this setup. A value such as `http://localhost:3001` would send each student's browser to their own laptop. Rebuild after changing frontend environment settings.

## Hosting instead

Use a Node-compatible web host with HTTPS. Build with `npm ci && npm --prefix client ci && npm --prefix client run build`; start with `npm start`. Set Gemini/ElevenLabs keys as **server environment variables**, never `VITE_` variables. The server uses the host's `PORT` when provided.

Run **one server process/instance** for this demo. Current live-course data is in memory, so a restart/redeploy clears it and multiple instances would have separate data. A temporary database is not necessary for one running demo. Use the team's PostgreSQL work before needing restart-safe history or more than one server instance. No hosting account or database is provisioned by these code changes.

## What is shared (and what is not)

- Existing dashboard charts: reaction type, slide number, timestamp, and whether a question/highlight was attached. No student name/email or raw text is returned by the dashboard API.
- Extra metadata, available at `/api/dashboard/COURSE-CODE`: joins, session starts/finishes, slide loads/changes, note-edit activity (at most once per ten seconds), slide highlights, recording starts/stops, and focus nudge display/dismissal. **These extra events have no new UI panel.** They are not proof of attention or inattention.
- Participant count means anonymous browser/lecture sessions that have joined, **not** current online attendance or unique verified people.
- Notes and lecture history remain local to the browser. Full notes are not sent as activity. Selected flagged text is stored on the server for existing AI insights; AI questions may include note excerpts and transcript context. Recordings send transcription data to ElevenLabs; AI requests send context to Gemini.
- Transcript windows are kept separate for each anonymous participant. They are not included in dashboard responses.
- Failed event deliveries are queued locally and retry while the app is open; event IDs avoid counting the same retry twice. Closing the page while offline pauses retries until it is opened again. Browser storage must be available for reload-safe retries.

This is a **trusted hackathon demo**, not authenticated classroom software. Anyone with the URL/code can access its anonymous statistics or submit reactions. Codes are routing labels, not passwords; AI summaries are not a guaranteed anonymization system. Do not use sensitive real student data on a public demo. Authentication, access controls, rate limits, retention/deletion, and durable storage are still needed before real deployment.

## Checks (no database or paid AI calls)

```bash
node --test server/liveRoutes.test.js client/src/live/outbox.test.js
npm --prefix client run build
```

The tests cover two students in one course, different-course isolation, all current reaction types, duplicate retries, dashboard redaction, transcript separation, and offline retry storage.
