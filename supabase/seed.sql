-- Local development seed for the wa-li monorepo (not part of the registry item).
-- Private bucket used by the Supabase adapter's storage (WA_STORAGE_BUCKET default).
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;
