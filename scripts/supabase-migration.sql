-- furnishes-studio — server-side conversation persistence.
--
-- Run this once in your Supabase project's SQL Editor (or via
-- `supabase db push`) to provision the tables, indexes, and Row-Level
-- Security policies the app uses.
--
-- The app degrades gracefully when Supabase isn't configured (no
-- NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) — local-
-- only IndexedDB persistence keeps working. When Supabase IS
-- configured AND the user is signed in, conversations and messages
-- sync across devices via the API routes under /api/conversations.
--
-- Schema notes:
--   * IDs are TEXT, generated client-side ("convo_<base36>_<rand>",
--     "msg_<base36>_<rand>"). The client doesn't need a DB roundtrip
--     to know an ID; first writes go to local IDB instantly, server
--     sync follows asynchronously.
--   * `project_id` is TEXT (not a foreign key) because the studio's
--     project model is local-first — projects don't exist server-side
--     yet; conversations just tag themselves with whichever project
--     ID the client knows about.
--   * Row-Level Security: every row is locked to its owning user.
--     Users only ever see their own conversations and messages.
--   * The `position_hint` on messages is kept for future ordering
--     beyond `created_at` (if a user backdates or reorders turns).

-- ─── Conversations ────────────────────────────────────────────────────

create table if not exists public.conversations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  title text not null default 'Conversation 1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_project_idx
  on public.conversations (user_id, project_id, updated_at desc);

-- ─── Messages ────────────────────────────────────────────────────────
--
-- Each message row stores both the user prompt AND the assistant
-- response, mirroring the studio's `ConversationTurn` shape (one
-- row = one round trip). This keeps writes simple — a single row
-- per send. Ordering is by `created_at` ascending.

create table if not exists public.messages (
  id text primary key,
  conversation_id text not null
    references public.conversations(id) on delete cascade,
  -- The studio's ConversationTurn fields:
  user_text text not null default '',
  response text not null default '',
  -- Pre-formatted display string ("10:42 AM") matching the slice's
  -- existing convention. Server-side we ALSO have created_at as
  -- the source of truth — `time` is just the cached display copy.
  display_time text not null default '',
  -- Future: extracted preferences, action emissions, attachments.
  metadata jsonb,
  created_at timestamptz not null default now(),
  position_hint integer not null default 0
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at, position_hint);

-- ─── Row-Level Security ──────────────────────────────────────────────

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Conversations: only owner can read or write.

drop policy if exists "conversations_select_own"
  on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "conversations_insert_own"
  on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "conversations_update_own"
  on public.conversations;
create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conversations_delete_own"
  on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- Messages: only owner of the parent conversation can read or write.

drop policy if exists "messages_select_own"
  on public.messages;
create policy "messages_select_own"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own"
  on public.messages;
create policy "messages_insert_own"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_update_own"
  on public.messages;
create policy "messages_update_own"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own"
  on public.messages;
create policy "messages_delete_own"
  on public.messages for delete
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- ─── updated_at auto-bump trigger ─────────────────────────────────────
--
-- When a row in conversations is updated, bump updated_at. (For
-- messages we don't typically update after insert; we just append.)

create or replace function public.touch_conversations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_updated_at_bump
  on public.conversations;
create trigger conversations_updated_at_bump
  before update on public.conversations
  for each row execute function public.touch_conversations_updated_at();
