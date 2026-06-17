-- ============================================================
-- AttendCount Database Schema
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT        UNIQUE NOT NULL,
  name               TEXT,
  avatar_url         TEXT,
  semester_end_date  DATE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Subjects ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subjects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  TEXT        NOT NULL REFERENCES public.users(email) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('theory', 'lab')),
  weight      INT         NOT NULL GENERATED ALWAYS AS (
                            CASE WHEN type = 'lab' THEN 3 ELSE 1 END
                          ) STORED,
  -- Timetable: JSON map of day → array of slot indices
  -- e.g. {"Monday": [0, 2], "Wednesday": [0, 2], "Friday": [0, 2]}
  timetable   JSONB       DEFAULT '{}',
  color       TEXT        DEFAULT '#adc6ff',
  is_active   BOOLEAN     DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Daily Logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  TEXT        NOT NULL,
  subject_id  UUID        REFERENCES public.subjects(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('present', 'absent', 'holiday')),
  label       TEXT,       -- For holidays: e.g. "Gandhi Jayanti"
  source      TEXT        DEFAULT 'manual',  -- 'manual' | 'google_calendar'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, subject_id, date)
);

-- Index for fast date range queries
CREATE INDEX IF NOT EXISTS daily_logs_date_idx ON public.daily_logs (user_email, date);
CREATE INDEX IF NOT EXISTS daily_logs_subject_idx ON public.daily_logs (subject_id, date);

-- ─── Baseline (Portal Sync Snapshot) ─────────────────────
CREATE TABLE IF NOT EXISTS public.baseline (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email        TEXT        NOT NULL,
  subject_id        UUID        REFERENCES public.subjects(id) ON DELETE CASCADE,
  official_held     INT         NOT NULL DEFAULT 0,
  official_attended INT         NOT NULL DEFAULT 0,
  last_sync_date    DATE,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, subject_id)
);

-- ─── Error Logs (client-side crash reporting) ─────────────
CREATE TABLE IF NOT EXISTS public.error_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  TEXT,
  message     TEXT,
  stack       TEXT,
  user_agent  TEXT,
  url         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Timetable Slot Config ────────────────────────────────
-- Stores user-defined slot timing (global across all subjects)
CREATE TABLE IF NOT EXISTS public.slot_timings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  TEXT        NOT NULL UNIQUE,
  slots       JSONB       NOT NULL DEFAULT '[
    {"start": "09:00", "end": "10:00"},
    {"start": "10:00", "end": "11:00"},
    {"start": "11:00", "end": "12:00"},
    {"start": "13:00", "end": "14:00"},
    {"start": "14:00", "end": "15:00"},
    {"start": "15:00", "end": "16:00"}
  ]',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Calendar Sync State ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_sync (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  TEXT        NOT NULL UNIQUE,
  enabled     BOOLEAN     DEFAULT FALSE,
  last_synced TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- All tables are scoped strictly to the authenticated user
-- ============================================================

ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baseline       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_timings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync  ENABLE ROW LEVEL SECURITY;

-- Users: can only read/write their own row
CREATE POLICY "Users: own row" ON public.users
  FOR ALL USING (email = auth.jwt() ->> 'email');

-- Subjects: own rows only
CREATE POLICY "Subjects: own rows" ON public.subjects
  FOR ALL USING (user_email = auth.jwt() ->> 'email');

-- Daily Logs: own rows only
CREATE POLICY "Daily Logs: own rows" ON public.daily_logs
  FOR ALL USING (user_email = auth.jwt() ->> 'email');

-- Baseline: own rows only
CREATE POLICY "Baseline: own rows" ON public.baseline
  FOR ALL USING (user_email = auth.jwt() ->> 'email');

-- Error Logs: insert only (no SELECT — we don't show users their own errors)
CREATE POLICY "Error Logs: insert" ON public.error_logs
  FOR INSERT WITH CHECK (TRUE);

-- Slot timings: own row only
CREATE POLICY "Slot Timings: own row" ON public.slot_timings
  FOR ALL USING (user_email = auth.jwt() ->> 'email');

-- Calendar sync state: own row only
CREATE POLICY "Calendar Sync: own row" ON public.calendar_sync
  FOR ALL USING (user_email = auth.jwt() ->> 'email');

-- ============================================================
-- Stored Function: Dashboard Aggregation
-- Returns per-subject attendance stats for the dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard(p_email TEXT)
RETURNS TABLE (
  subject_id          UUID,
  subject_name        TEXT,
  subject_type        TEXT,
  weight              INT,
  color               TEXT,
  timetable           JSONB,
  official_held       INT,
  official_attended   INT,
  last_sync_date      DATE,
  realtime_held       BIGINT,
  realtime_attended   BIGINT,
  total_held          BIGINT,
  total_attended      BIGINT,
  percentage          NUMERIC,
  safe_to_miss        BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id                                           AS subject_id,
    s.name                                         AS subject_name,
    s.type                                         AS subject_type,
    s.weight                                       AS weight,
    s.color                                        AS color,
    s.timetable                                    AS timetable,
    COALESCE(b.official_held, 0)                   AS official_held,
    COALESCE(b.official_attended, 0)               AS official_attended,
    b.last_sync_date                               AS last_sync_date,

    -- Real-time log stats (after last sync date)
    (COALESCE(SUM(s.weight) FILTER (
      WHERE dl.status IN ('present', 'absent')
        AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
    ), 0))::BIGINT                                 AS realtime_held,

    (COALESCE(SUM(s.weight) FILTER (
      WHERE dl.status = 'present'
        AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
    ), 0))::BIGINT                                 AS realtime_attended,

    -- Totals
    (COALESCE(b.official_held, 0) + COALESCE(SUM(s.weight) FILTER (
      WHERE dl.status IN ('present', 'absent')
        AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
    ), 0))::BIGINT                                 AS total_held,

    (COALESCE(b.official_attended, 0) + COALESCE(SUM(s.weight) FILTER (
      WHERE dl.status = 'present'
        AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
    ), 0))::BIGINT                                 AS total_attended,

    -- Percentage (guard against division by zero)
    CASE
      WHEN (COALESCE(b.official_held, 0) + COALESCE(SUM(s.weight) FILTER (
              WHERE dl.status IN ('present', 'absent')
                AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
            ), 0)) = 0 THEN 0::NUMERIC
      ELSE ROUND(
        (COALESCE(b.official_attended, 0) + COALESCE(SUM(s.weight) FILTER (
          WHERE dl.status = 'present'
            AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
        ), 0))::NUMERIC /
        (COALESCE(b.official_held, 0) + COALESCE(SUM(s.weight) FILTER (
          WHERE dl.status IN ('present', 'absent')
            AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
        ), 0))::NUMERIC * 100, 1
      )::NUMERIC
    END                                            AS percentage,

    -- Safe-to-miss = floor((attended - 0.75 * held) / 0.25)
    CASE
      WHEN (COALESCE(b.official_held, 0) + COALESCE(SUM(s.weight) FILTER (
              WHERE dl.status IN ('present', 'absent')
                AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
            ), 0)) = 0 THEN 0::BIGINT
      ELSE FLOOR(
        (COALESCE(b.official_attended, 0) + COALESCE(SUM(s.weight) FILTER (
          WHERE dl.status = 'present'
            AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
        ), 0) -
        0.75 * (COALESCE(b.official_held, 0) + COALESCE(SUM(s.weight) FILTER (
          WHERE dl.status IN ('present', 'absent')
            AND (b.last_sync_date IS NULL OR dl.date > b.last_sync_date)
        ), 0))) / 0.25
      )::BIGINT
    END                                            AS safe_to_miss

  FROM public.subjects s
  LEFT JOIN public.baseline b
    ON b.subject_id = s.id AND b.user_email = p_email
  LEFT JOIN public.daily_logs dl
    ON dl.subject_id = s.id AND dl.user_email = p_email
  WHERE s.user_email = p_email AND s.is_active = TRUE
  GROUP BY s.id, s.name, s.type, s.weight, s.color, s.timetable,
           b.official_held, b.official_attended, b.last_sync_date;
END;
$$;
