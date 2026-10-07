-- Private bucket for inbound media (or create it in Studio > Storage, "Public" off).
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;
