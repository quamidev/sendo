-- Private bucket for inbound media (or create it in Studio > Storage, "Public" off).
insert into storage.buckets (id, name, public)
values ('sendo-media', 'sendo-media', false)
on conflict (id) do nothing;
