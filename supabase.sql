-- BakyHub: ejecutar en Supabase > SQL Editor.
-- Este script crea/actualiza las tablas base y habilita políticas RLS.
-- No pegues nunca una service_role key en el navegador.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text not null default '',
  status text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists status text not null default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Para perfiles antiguos sin username, generar uno temporal único.
update public.profiles
set username = 'user_' || left(replace(id::text, '-', ''), 12)
where username is null or btrim(username) = '';

create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));
alter table public.profiles alter column username set not null;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  media_url text,
  media_type text,
  created_at timestamptz not null default now(),
  constraint posts_content_or_media check (length(trim(content)) > 0 or media_url is not null)
);
alter table public.posts add column if not exists media_url text;
alter table public.posts add column if not exists media_type text;
alter table public.posts add column if not exists content text not null default '';
alter table public.posts add column if not exists created_at timestamptz not null default now();

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_request_not_self check (sender_id <> receiver_id)
);
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendship_not_self check (user_id <> friend_id),
  constraint friendship_pair_unique unique (user_id, friend_id)
);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests(receiver_id, status);
create index if not exists friend_requests_sender_status_idx on public.friend_requests(sender_id, status);
create index if not exists friendships_user_idx on public.friendships(user_id);
create index if not exists friendships_friend_idx on public.friendships(friend_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);

-- Crea automáticamente un perfil al registrar un usuario nuevo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  requested_username := regexp_replace(requested_username, '[^a-z0-9_]', '_', 'g');
  if length(requested_username) < 3 then
    requested_username := 'user_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  requested_username := left(requested_username, 24);
  if exists (select 1 from public.profiles p where lower(p.username) = requested_username) then
    requested_username := left(requested_username, 14) || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  insert into public.profiles (id, username, display_name, bio, status)
  values (new.id, requested_username, coalesce(new.raw_user_meta_data ->> 'display_name', requested_username), '', '')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

-- Perfiles: username y perfil son públicos; cada persona solo modifica el suyo.
drop policy if exists "Profiles are visible to everyone" on public.profiles;
create policy "Profiles are visible to everyone" on public.profiles for select using (true);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Publicaciones visibles para usuarios autenticados; cada persona administra las suyas.
drop policy if exists "Authenticated users can view posts" on public.posts;
create policy "Authenticated users can view posts" on public.posts for select to authenticated using (true);
drop policy if exists "Users create own posts" on public.posts;
create policy "Users create own posts" on public.posts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users delete own posts" on public.posts;
create policy "Users delete own posts" on public.posts for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own posts" on public.posts;
create policy "Users update own posts" on public.posts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Solicitudes: el emisor crea y cancela; el receptor ve y responde.
drop policy if exists "Users view their friend requests" on public.friend_requests;
create policy "Users view their friend requests" on public.friend_requests for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);
drop policy if exists "Users send friend requests" on public.friend_requests;
create policy "Users send friend requests" on public.friend_requests for insert to authenticated
with check (auth.uid() = sender_id and sender_id <> receiver_id and status = 'pending');
drop policy if exists "Receiver responds to friend request" on public.friend_requests;
create policy "Receiver responds to friend request" on public.friend_requests for update to authenticated
using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);
drop policy if exists "Sender cancels friend request" on public.friend_requests;
create policy "Sender cancels friend request" on public.friend_requests for delete to authenticated
using (auth.uid() = sender_id);

-- La relación se guarda en un solo par ordenado (UUID menor primero).
drop policy if exists "Friends can view friendship rows" on public.friendships;
create policy "Friends can view friendship rows" on public.friendships for select to authenticated
using (auth.uid() = user_id or auth.uid() = friend_id);
drop policy if exists "Receiver can create accepted friendship" on public.friendships;
create policy "Receiver can create accepted friendship" on public.friendships for insert to authenticated
with check (
  exists (
    select 1 from public.friend_requests r
    where r.status = 'pending'
      and r.sender_id = least(user_id, friend_id)
      and r.receiver_id = greatest(user_id, friend_id)
      and r.receiver_id = auth.uid()
  )
  or exists (
    select 1 from public.friend_requests r
    where r.status = 'pending'
      and r.sender_id = greatest(user_id, friend_id)
      and r.receiver_id = least(user_id, friend_id)
      and r.receiver_id = auth.uid()
  )
);
drop policy if exists "Either friend can remove friendship" on public.friendships;
create policy "Either friend can remove friendship" on public.friendships for delete to authenticated
using (auth.uid() = user_id or auth.uid() = friend_id);

-- Storage buckets públicos para mostrar imágenes y medios mediante URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists "Public can read post media" on storage.objects;
create policy "Public can read post media" on storage.objects for select using (bucket_id = 'post-media');
drop policy if exists "Users upload own post media" on storage.objects;
create policy "Users upload own post media" on storage.objects for insert to authenticated
with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own post media" on storage.objects;
create policy "Users update own post media" on storage.objects for update to authenticated
using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own post media" on storage.objects;
create policy "Users delete own post media" on storage.objects for delete to authenticated
using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Public can read profile avatars" on storage.objects;
create policy "Public can read profile avatars" on storage.objects for select using (bucket_id = 'profile-avatars');
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects for update to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Nota: los perfiles con usernames antiguos deben revisarse si existen duplicados antes de aplicar el índice único.
