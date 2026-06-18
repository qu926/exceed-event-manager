create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_select" on public.app_state;
drop policy if exists "app_state_insert" on public.app_state;
drop policy if exists "app_state_update" on public.app_state;

create policy "app_state_select"
on public.app_state
for select
using (id in ('exceed-event-manager', 'syndicate-event-manager', 'central-event-manager'));

create policy "app_state_insert"
on public.app_state
for insert
with check (id in ('exceed-event-manager', 'syndicate-event-manager', 'central-event-manager'));

create policy "app_state_update"
on public.app_state
for update
using (id in ('exceed-event-manager', 'syndicate-event-manager', 'central-event-manager'))
with check (id in ('exceed-event-manager', 'syndicate-event-manager', 'central-event-manager'));

insert into public.app_state (id, payload)
values
  ('exceed-event-manager', '{}'::jsonb),
  ('syndicate-event-manager', '{}'::jsonb),
  ('central-event-manager', '{}'::jsonb)
on conflict (id) do nothing;
