---
"@quami/sendo": minor
---

`sendo.links`: `create({ account?, tenant?, text?, source })` returns a `wa.me` click-to-chat link whose prefilled text ends with ` [#source]` (`{ url, code, phone, text }`; resolves the number like `send.*`, writes nothing; `source` must match `^[a-z0-9-]{1,32}$`). `sources({ actor, account?, from?, to? })` counts conversations per source in the actor's tenant (admin only, `numbers.manage`). New pure helper `buildWhatsAppLink({ phone, text?, source })` and `LINK_SOURCE_RE`. The `sendo-widgets` registry item adds the links screen (QR with PNG/SVG download, chat bubble snippet, sources table) and `<SendoChatBubble />`.
