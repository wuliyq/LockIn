-- LockIn database schema (local Postgres 16).
-- Setup only: this DROPs every table. Do not rerun once demo data is in.
--   psql lockin -f server/db/schema.sql
--
-- The lecturer dashboard groups the room by (class_id, lecture_date), never by a
-- single lecture id: every student has their own lecture row, so eleven students
-- in one room are eleven lecture ids. All dashboard queries join through lectures.
--
-- Anonymity: the server can link a flag to a user through lectures.student_id and
-- chooses not to. Lecturer responses are aggregates gated at 3 distinct students,
-- enforced in SQL, and never include another student's notes, snapshot, raw
-- questions or AI answers.

DROP TABLE IF EXISTS transcript_segments;
DROP TABLE IF EXISTS flags;
DROP TABLE IF EXISTS lectures;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS users;

-- No login: the client creates an anonymous row on first load and keeps its id in
-- localStorage. The student/lecturer switch is a UI toggle, not a stored role.
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  email         TEXT        UNIQUE,
  password_hash TEXT,       -- unused until real accounts exist
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Students join by code when starting a lecture; the dashboard opens by code.
-- Codes are stored upper-case so "bio101" and "BIO101" are the same class.
CREATE TABLE classes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lecturer_id UUID        NOT NULL REFERENCES users (id),
  title       TEXT        NOT NULL,
  code        TEXT        NOT NULL UNIQUE CHECK (code = upper(code) AND code <> ''),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One student's lecture: one class on one day. id is the sessionId the client
-- sends to /api/flags, /api/transcript and /api/catch-up.
CREATE TABLE lectures (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  class_id     UUID        REFERENCES classes (id) ON DELETE SET NULL,  -- NULL = independent study
  title        TEXT,
  filename     TEXT,
  -- Hash of the deck's extracted text. Per-slide views only count lectures on the
  -- class's most common deck, so "slide 5" means the same page for everyone.
  deck_hash    TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  -- Groups the room. Generated so it can never drift from started_at.
  -- Must match COURSE_TZ in .env (one timezone per deployment: a known limitation).
  lecture_date DATE        NOT NULL GENERATED ALWAYS AS
                 ((started_at AT TIME ZONE 'America/New_York')::date) STORED,
  snapshot     JSONB,      -- the student's private copy; never sent to a lecturer
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- set explicitly by every UPDATE
);

CREATE INDEX ON lectures (class_id, lecture_date);
CREATE INDEX ON lectures (student_id, started_at DESC);

-- Columns with NOT NULL DEFAULT only get the default when the INSERT omits them; a
-- parameterised insert passing NULL fails instead. Inserts COALESCE them.
CREATE TABLE flags (
  id            BIGSERIAL   PRIMARY KEY,
  session_id    UUID        NOT NULL REFERENCES lectures (id) ON DELETE CASCADE,
  type          TEXT        NOT NULL
                  CHECK (type IN ('catch_up', 'confusing', 'real_world', 'worked_example')),
  slide_index   INT         NOT NULL DEFAULT -1 CHECK (slide_index >= -1),  -- 0-based; -1 = unknown
  -- Where selected_text came from. Only 'slide' text is the lecturer's own words and
  -- safe to show verbatim; 'notes' text is the student's writing and is treated like
  -- student_text.
  source        TEXT        CHECK (source IN ('slide', 'notes')),
  selected_text TEXT,
  student_text  TEXT,       -- never shown to a lecturer unparaphrased
  ai_answer     TEXT,       -- restates the question, so same rule as student_text
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- server clock, never the client's
);

CREATE INDEX ON flags (session_id, received_at DESC);
CREATE INDEX ON flags (session_id, slide_index);

-- Every student's laptop may record its own copy. The drill-down reads one
-- lecture's segments per (class, date): the one with the most coverage.
CREATE TABLE transcript_segments (
  id          BIGSERIAL   PRIMARY KEY,
  session_id  UUID        NOT NULL REFERENCES lectures (id) ON DELETE CASCADE,
  slide_index INT         NOT NULL DEFAULT -1 CHECK (slide_index >= -1),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  text        TEXT        NOT NULL CHECK (text <> '')
);

CREATE INDEX ON transcript_segments (session_id, started_at);
