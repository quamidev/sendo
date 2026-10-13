---
"@quami/sendo": minor
---

Add `createSendo({ locale })` (`"en" | "es"`, default `"en"`) and structured system events.

- **Breaking (minor while 0.x): the built-in end-customer messages are now English by default.** The handoff message is "Connecting you with someone from the team." and the opt-out confirmation is "Done, we won't send you promotional messages anymore. If you change your mind, message us." To keep the previous Spanish text, pass `locale: "es"`. An explicit `handoffMessage`, `handoff.message` or `optOut.confirmation` still wins.
- New exports: `SendoLocale`, `BUILT_IN_MESSAGES` (the one table of built-in messages per locale), `BuiltInMessages`, `SystemEventName` and `SYSTEM_LINE_EVENTS`. `DEFAULT_HANDOFF_MESSAGE` and `DEFAULT_OPT_OUT_CONFIRMATION` stay exported and now hold the English values.
- System lines keep `metadata.event` and now store every value their sentence uses as params (`reason`, `assignedTo`, `assignedToName`, `byName`, `ruleKey`, `queue`, `tags`, `minutesWaiting`, `afterDays`, `agentResumeFrom`). The stored `text` is English. `InboxSystemLine` gains `params`, so a client can render each line in the viewer's language from `event` + `params` and fall back to `text`. Rows written earlier (Spanish `text`, missing or unknown event) come through unchanged.
- A route rule that hands off without a `reason` now stores `Rule «<key>»` as the handoff reason (was `Regla «<key>»`).
