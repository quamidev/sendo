---
"@quami/sendo": minor
---

`sendo.metrics`: `daily`, `byAssignee`, `firstResponse`, `aiResolution`, `bySource` and `cost`, each taking `{ actor, from, to, account?, tagIds? }`. Tenant-scoped to the actor; needs `metrics.view` (supervisors and admins), and `cost` needs `costs.view` (admins). For actors without `costs.view`, `daily` returns `costCents`, `tokensIn` and `tokensOut` as `null`. `byAssignee` adds `name` and `avatarUrl` from `resolveUsers`. `account` accepts an account id or Meta phone number id of the tenant (disconnected numbers included); `tagIds` is an any-match tag cut. New helpers `metricsDayRange({ from, to, timeZone })` (calendar days, both included, to local-midnight instants) and `metricsLocalDay(timeZone, at?)`, and the types `MetricsDaily` and `MetricsAssignee`. The `sendo-metrics` registry item adds the "Métricas" screen at `/inbox/metrics`.
