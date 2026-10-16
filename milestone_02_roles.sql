-- MILESTONE 02: host starts game + private role assignment.
-- IMPORTANT: Run this migration in the SAME Mafia Supabase project used by Milestone 01.
-- Do NOT rerun the original supabase.sql. This file adds the role system to the existing schema.

create table if not exists public.private_room_roles (
  room_id uuid not null references public.private_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('Mafia', 'Detective', 'Doctor', 'Villager')),
  assigned_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.private_room_roles enable row level security;
revoke all on public.private_room_roles from anon, authenticated;

-- Replace join function to lock the room row, preventing a join racing with game start.
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
  where code = upper(trim(coalesce(p_room_code, '')))
  for update;

  if not found or v_room.status <> 'lobby' then
    raise exception 'Room not found or no longer accepting players';
  end if;

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

create or replace function public.start_private_game(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_room public.private_rooms;
  v_count integer;
  v_mafia_count integer;
begin
  if v_user is null then raise exception 'Sign in before starting a game'; end if;

  select * into v_room
  from public.private_rooms
  where code = upper(trim(coalesce(p_room_code, '')))
  for update;

  if not found then raise exception 'Room not found'; end if;
  if v_room.host_user_id <> v_user then raise exception 'Only the room host can start the game'; end if;
  if v_room.status <> 'lobby' then raise exception 'This game has already started'; end if;

  select count(*) into v_count
  from public.private_room_members
  where room_id = v_room.id;

  if v_count < 4 then raise exception 'At least 4 players are required to start'; end if;
  if v_count > 15 then raise exception 'This room has too many players'; end if;

  -- One Mafia per four players (rounded down), minimum one. One Detective and one Doctor.
  v_mafia_count := greatest(1, floor(v_count::numeric / 4)::integer);

  delete from public.private_room_roles where room_id = v_room.id;

  insert into public.private_room_roles(room_id, user_id, role)
  select v_room.id, shuffled.user_id,
    case
      when shuffled.position <= v_mafia_count then 'Mafia'
      when shuffled.position = v_mafia_count + 1 then 'Detective'
      when shuffled.position = v_mafia_count + 2 then 'Doctor'
      else 'Villager'
    end
  from (
    select m.user_id, row_number() over (order by random()) as position
    from public.private_room_members m
    where m.room_id = v_room.id
  ) as shuffled;

  update public.private_rooms set status = 'in_game' where id = v_room.id;

  return jsonb_build_object('ok', true, 'status', 'in_game');
end;
$$;

-- This RPC returns all public player names, but ONLY the caller's own role.
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
  v_self_role text := null;
begin
  if v_user is null then raise exception 'Sign in before viewing a room'; end if;

  select r.* into v_room
  from public.private_rooms r
  where r.code = upper(trim(coalesce(p_room_code, '')));

  if not found then return jsonb_build_object('room', null, 'players', '[]'::jsonb, 'self_role', null); end if;

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

  if v_room.status = 'in_game' or v_room.status = 'finished' then
    select rr.role into v_self_role
    from public.private_room_roles rr
    where rr.room_id = v_room.id and rr.user_id = v_user;
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'host_user_id', v_room.host_user_id, 'status', v_room.status
    ),
    'players', v_players,
    'self_role', v_self_role
  );
end;
$$;

revoke execute on function public.join_private_room(text, text) from public, anon;
revoke execute on function public.start_private_game(text) from public, anon;
revoke execute on function public.get_private_room_state(text) from public, anon;
grant execute on function public.join_private_room(text, text) to authenticated;
grant execute on function public.start_private_game(text) to authenticated;
grant execute on function public.get_private_room_state(text) to authenticated;
