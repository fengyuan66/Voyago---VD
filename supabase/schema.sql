create table if not exists public.voyago_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_voyago_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_voyago_state_updated_at on public.voyago_state;
create trigger trg_touch_voyago_state_updated_at
before update on public.voyago_state
for each row
execute function public.touch_voyago_state_updated_at();
