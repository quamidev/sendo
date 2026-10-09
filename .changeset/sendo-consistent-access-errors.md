---
"@quami/sendo": patch
---

Consistent access errors across the team APIs. Every method that takes `{ actor }` (`sendo.inbox`, `snippets`, `tags`, `rules`, `broadcasts`, `metrics`, `links.sources`) now refuses a missing or forged actor (no user id, unknown or `null` role) with `ForbiddenError` (`role: null`, plus the capability the call needs) before reading anything; `snippets.list`, `snippets.get`, `snippets.render` and `tags.list` used to answer such an actor. An `accountId` filter on `inbox.list`, `inbox.count`, `snippets.list`, `rules.list` and `broadcasts.list` must name a number of the actor's tenant (connected or not, by id or Meta phone number id), else `AccountNotFoundError`, like every other account argument. `inbox.tags.add` / `remove` refuse an unknown tag or one of another tenant with `RecordNotFoundError` (`entity: "tag"`). The inbox list reads pending drafts with one batched query, so a draft older than the last 30 messages still shows.
