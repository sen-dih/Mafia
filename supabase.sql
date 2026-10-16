-- MILESTONE 01: private rooms and lobby state
-- Run this entire file in Supabase SQL Editor.
-- Then enable Anonymous Sign-Ins under Authentication > Sign In / Providers.
-- No secret roles or match logic are stored in this milestone.

create extension if not exists pgcrypto;

create table if not exists public.private_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','in_game','finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.private_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.private_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 18),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, display_name)
);

create index if not exists private_room_members_room_idx
  on public.private_room_members(room_id, joined_at);

alter table public.private_rooms enable row level security;
alter table public.private_room_members enable row level security;

-- Client users cannot read/write these tables directly. They use checked RPC functions.
revoke all on public.private_rooms from anon, authenticated;
revoke all on public.private_room_members from anon, authenticated;
create or replace function public.create_private_room(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_room public.private_rooms;
  v_name text := regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
begin
  if v_user is null then raise exception 'Sign in before creating a room'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 18 then
    raise exception 'Player name must be 1 to 18 characters';
  end if;

  -- Short, shareable code; retry on the extremely unlikely collision.
  for i in 1..5 loop
    v_code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 6));
    begin
      insert into public.private_rooms(code, host_user_id)
      values (v_code, v_user) returning * into v_room;
      exit;
    exception when unique_violation then
      if i = 5 then raise exception 'Could not generate a room code. Try again'; end if;
    end;
  end loop;

  insert into public.private_room_members(room_id, user_id, display_name)
  values (v_room.id, v_user, v_name);

  return jsonb_build_object('room', jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'host_user_id', v_room.host_user_id, 'status', v_room.status
  ));
end;
$$;

create or replace function public.join_private_room(p_room_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_room public.private_rooms;
  v_name text := regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
  v_count integer;
begin
  if v_user is null then raise exception 'Sign in before joining a room'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 18 then
    raise exception 'Player name must be 1 to 18 characters';
  end if;

  select * into v_room
  from public.private_rooms
  where code = upper(trim(coalesce(p_room_code, ''))) and status = 'lobby';

  if not found then raise exception 'Room not found or no longer accepting players'; end if;

  if exists (
    select 1 from public.private_room_members
    where room_id = v_room.id and user_id = v_user
  ) then
    return jsonb_build_object('room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'host_user_id', v_room.host_user_id, 'status', v_room.status
    ));
  end if;

  select count(*) into v_count from public.private_room_members where room_id = v_room.id;
  if v_count >= 15 then raise exception 'This room is full (15 players maximum)'; end if;

  insert into public.private_room_members(room_id, user_id, display_name)
  values (v_room.id, v_user, v_name);

  return jsonb_build_object('room', jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'host_user_id', v_room.host_user_id, 'status', v_room.status
  ));
exception
  when unique_violation then
    raise exception 'That player name is already taken in this room';
end;
$$;

create or replace function public.get_private_room_state(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_room public.private_rooms;
  v_players jsonb;
begin
  if v_user is null then raise exception 'Sign in before viewing a room'; end if;

  select r.* into v_room
  from public.private_rooms r
  where r.code = upper(trim(coalesce(p_room_code, '')));

  if not found then return jsonb_build_object('room', null, 'players', '[]'::jsonb); end if;

  if not exists (
    select 1 from public.private_room_members m
    where m.room_id = v_room.id and m.user_id = v_user
  ) then
    raise exception 'You are not a member of this room';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'display_name', m.display_name, 'joined_at', m.joined_at
  ) order by m.joined_at), '[]'::jsonb)
  into v_players
  from public.private_room_members m
  where m.room_id = v_room.id;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'host_user_id', v_room.host_user_id, 'status', v_room.status
    ),
    'players', v_players
  );
end;
$$;

-- Keep function ownership with the database owner (default for SQL Editor).
-- These functions are SECURITY DEFINER, so keep their bodies narrowly scoped.

-- Remove default PUBLIC execution and allow signed-in (including anonymous-auth) users only.
revoke execute on function public.create_private_room(text) from public, anon;
revoke execute on function public.join_private_room(text, text) from public, anon;
revoke execute on function public.get_private_room_state(text) from public, anon;
grant execute on function public.create_private_room(text) to authenticated;
grant execute on function public.join_private_room(text, text) to authenticated;
grant execute on function public.get_private_room_state(text) to authenticated;
