-- Enums
DO $$ BEGIN
  CREATE TYPE public.room_status AS ENUM ('lobby', 'playing', 'finished', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.seat_kind AS ENUM ('human', 'bot', 'empty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  status       public.room_status NOT NULL DEFAULT 'lobby',
  target_cames INTEGER NOT NULL DEFAULT 2 CHECK (target_cames BETWEEN 1 AND 5),
  initial_mano SMALLINT NOT NULL DEFAULT 0 CHECK (initial_mano BETWEEN 0 AND 3),
  seat_kinds   public.seat_kind[] NOT NULL,
  host_device  TEXT NOT NULL,
  match_state  JSONB,
  bot_intents  JSONB NOT NULL DEFAULT '{}'::jsonb,
  turn_started_at timestamptz,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_code_idx ON public.rooms (code);
CREATE INDEX IF NOT EXISTS rooms_status_idx ON public.rooms (status);

CREATE TABLE IF NOT EXISTS public.room_players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  seat        SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 3),
  device_id   TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  is_online   BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, seat)
);
CREATE INDEX IF NOT EXISTS room_players_room_idx ON public.room_players (room_id);
CREATE INDEX IF NOT EXISTS room_players_device_idx ON public.room_players (device_id);

CREATE TABLE IF NOT EXISTS public.room_actions (
  id        BIGSERIAL PRIMARY KEY,
  room_id   UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  seat      SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 3),
  action    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_actions_room_idx ON public.room_actions (room_id, id);

CREATE TABLE IF NOT EXISTS public.room_chat (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  seat smallint NOT NULL,
  phrase_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_chat_room_idx ON public.room_chat(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.room_text_chat (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  seat SMALLINT NOT NULL CHECK (seat >= 0 AND seat <= 3),
  device_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_text_chat_room_created ON public.room_text_chat(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.player_profiles (
  device_id text PRIMARY KEY,
  games_played integer NOT NULL DEFAULT 0,
  envit_called integer NOT NULL DEFAULT 0,
  envit_called_bluff integer NOT NULL DEFAULT 0,
  envit_accepted integer NOT NULL DEFAULT 0,
  envit_rejected integer NOT NULL DEFAULT 0,
  truc_called integer NOT NULL DEFAULT 0,
  truc_called_bluff integer NOT NULL DEFAULT 0,
  truc_accepted integer NOT NULL DEFAULT 0,
  truc_rejected integer NOT NULL DEFAULT 0,
  envit_strength_sum integer NOT NULL DEFAULT 0,
  envit_strength_n integer NOT NULL DEFAULT 0,
  truc_strength_sum integer NOT NULL DEFAULT 0,
  truc_strength_n integer NOT NULL DEFAULT 0,
  aggressiveness real NOT NULL DEFAULT 0.5,
  bluff_rate real NOT NULL DEFAULT 0.15,
  accept_threshold real NOT NULL DEFAULT 0.5,
  bot_difficulty text NOT NULL DEFAULT 'conservative' CHECK (bot_difficulty IN ('conservative', 'balanced', 'aggressive')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS bot_honesty text NOT NULL DEFAULT 'sincero';
ALTER TABLE public.player_profiles
  DROP CONSTRAINT IF EXISTS player_profiles_bot_honesty_check;
ALTER TABLE public.player_profiles
  ADD CONSTRAINT player_profiles_bot_honesty_check
  CHECK (bot_honesty IN ('sincero', 'pillo', 'mentider'));

ALTER TABLE public.rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_chat      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_text_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rooms_public_read" ON public.rooms;
CREATE POLICY "rooms_public_read" ON public.rooms FOR SELECT USING (true);
DROP POLICY IF EXISTS "room_players_public_read" ON public.room_players;
CREATE POLICY "room_players_public_read" ON public.room_players FOR SELECT USING (true);
DROP POLICY IF EXISTS "room_actions_public_read" ON public.room_actions;
CREATE POLICY "room_actions_public_read" ON public.room_actions FOR SELECT USING (true);
DROP POLICY IF EXISTS "room_chat_public_read" ON public.room_chat;
CREATE POLICY "room_chat_public_read" ON public.room_chat FOR SELECT USING (true);
DROP POLICY IF EXISTS "room_text_chat_public_read" ON public.room_text_chat;
CREATE POLICY "room_text_chat_public_read" ON public.room_text_chat FOR SELECT USING (true);
DROP POLICY IF EXISTS "player_profiles_public_read" ON public.player_profiles;
CREATE POLICY "player_profiles_public_read" ON public.player_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "rooms_no_client_insert" ON public.rooms;
CREATE POLICY "rooms_no_client_insert" ON public.rooms FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "rooms_no_client_update" ON public.rooms;
CREATE POLICY "rooms_no_client_update" ON public.rooms FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "rooms_no_client_delete" ON public.rooms;
CREATE POLICY "rooms_no_client_delete" ON public.rooms FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "room_players_no_client_insert" ON public.room_players;
CREATE POLICY "room_players_no_client_insert" ON public.room_players FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "room_players_no_client_update" ON public.room_players;
CREATE POLICY "room_players_no_client_update" ON public.room_players FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "room_players_no_client_delete" ON public.room_players;
CREATE POLICY "room_players_no_client_delete" ON public.room_players FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "room_actions_no_client_insert" ON public.room_actions;
CREATE POLICY "room_actions_no_client_insert" ON public.room_actions FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "room_actions_no_client_update" ON public.room_actions;
CREATE POLICY "room_actions_no_client_update" ON public.room_actions FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "room_actions_no_client_delete" ON public.room_actions;
CREATE POLICY "room_actions_no_client_delete" ON public.room_actions FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "room_chat_no_client_insert" ON public.room_chat;
CREATE POLICY "room_chat_no_client_insert" ON public.room_chat FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "room_chat_no_client_update" ON public.room_chat;
CREATE POLICY "room_chat_no_client_update" ON public.room_chat FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "room_chat_no_client_delete" ON public.room_chat;
CREATE POLICY "room_chat_no_client_delete" ON public.room_chat FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "room_text_chat_no_client_insert" ON public.room_text_chat;
CREATE POLICY "room_text_chat_no_client_insert" ON public.room_text_chat FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "room_text_chat_no_client_update" ON public.room_text_chat;
CREATE POLICY "room_text_chat_no_client_update" ON public.room_text_chat FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "room_text_chat_no_client_delete" ON public.room_text_chat;
CREATE POLICY "room_text_chat_no_client_delete" ON public.room_text_chat FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "player_profiles_no_client_insert" ON public.player_profiles;
CREATE POLICY "player_profiles_no_client_insert" ON public.player_profiles FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "player_profiles_no_client_update" ON public.player_profiles;
CREATE POLICY "player_profiles_no_client_update" ON public.player_profiles FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "player_profiles_no_client_delete" ON public.player_profiles;
CREATE POLICY "player_profiles_no_client_delete" ON public.player_profiles FOR DELETE TO anon, authenticated USING (false);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_touch ON public.rooms;
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS player_profiles_touch_updated_at ON public.player_profiles;
CREATE TRIGGER player_profiles_touch_updated_at
  BEFORE UPDATE ON public.player_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_actions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_chat;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_text_chat;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.cleanup_rooms()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  marked_offline_count int;
  abandoned_count      int;
  deleted_count        int;
BEGIN
  WITH upd AS (
    UPDATE public.room_players
       SET is_online = FALSE
     WHERE is_online = TRUE
       AND last_seen < (now() - interval '60 seconds')
    RETURNING 1
  )
  SELECT count(*) INTO marked_offline_count FROM upd;

  WITH upd AS (
    UPDATE public.rooms
       SET status     = 'abandoned',
           updated_at = now()
     WHERE status IN ('lobby', 'playing')
       AND updated_at < (now() - interval '15 minutes')
    RETURNING 1
  )
  SELECT count(*) INTO abandoned_count FROM upd;

  WITH del AS (
    DELETE FROM public.rooms
     WHERE status IN ('abandoned', 'finished')
       AND updated_at < (now() - interval '1 hour')
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM del;

  RETURN jsonb_build_object(
    'ran_at',           now(),
    'marked_offline',   marked_offline_count,
    'rooms_abandoned',  abandoned_count,
    'rooms_deleted',    deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rooms() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'rooms-cleanup';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END;
$$;

SELECT cron.schedule(
  'rooms-cleanup',
  '*/15 * * * *',
  $$ SELECT public.cleanup_rooms(); $$
);
