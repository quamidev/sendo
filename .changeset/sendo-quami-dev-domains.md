---
"@quami/sendo": patch
---

Point every Sendo URL at `sendo.quami.dev`. `sendo.dev` belongs to another company, and 0.1.0 used it as the default Connect host (`DEFAULT_CONNECT_BASE_URL`), so a Connect client without `baseUrl` would have sent its API key and the Embedded Signup code to a server Quami doesn't control.

- Connect defaults to `https://connect.sendo.quami.dev` (override with `connect.baseUrl` or `SENDO_CONNECT_BASE_URL` as before).
- Doctor fix links, schema changelog links and the package `homepage` now use `https://sendo.quami.dev`; the billing hint points at `https://app.sendo.quami.dev`.
- Registry items install from `registry.sendo.quami.dev`.

Upgrade from 0.1.0 if you use Connect.
