---
"@quami/sendo": minor
---

Remove the reserved hosted-transport stub.

Its factory and options type are no longer exported from `@quami/sendo`: every method only threw `NotImplementedError`, and no hosted mode that stores your data is planned. The `Transport` interface and `metaDirect` are unchanged, and `NotImplementedError` stays (a transport without `uploadMedia` or `markRead`, or `templates.sync` on a transport that isn't `metaDirect`). The roadmap now describes Sendo Connect and the channels still to come.
