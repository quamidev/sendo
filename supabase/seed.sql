-- Local development seed for the sendo monorepo (not part of the registry item).
-- Private bucket used by the Supabase adapter's storage (SENDO_STORAGE_BUCKET default).
insert into storage.buckets (id, name, public)
values ('sendo-media', 'sendo-media', false)
on conflict (id) do nothing;
