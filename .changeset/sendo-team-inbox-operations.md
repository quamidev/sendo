---
"@quami/sendo": minor
---

Team inbox operations: actor-based `sendo.inbox`, notes, drafts, agent pause and turn cost.

- **Breaking:** every `sendo.inbox.*` method takes `{ actor }` from `sendo.actor(userId, tenantId)` (needs `resolveRole`) instead of `tenantId` / `userId`, and enforces the role matrix: another tenant's conversation is `RECORD_NOT_FOUND`; a conversation the actor can't see, reassigning someone else, or pausing the AI without the role is `FORBIDDEN`. `reply` returns an `InboxMessage`; `markSeen` returns nothing.
- New: `inbox.get`, `count`, `note`, `take`, `assign`, `returnToAgent`, `close`, `pauseAgent`, `approveDraft`, `discardDraft`, `assignees`, `tags.add/remove`, and `sendo.conversations.pauseAgent(id, paused, { by })`.
- `InboxConversation` adds `channel`, `source`, `queue`, `assignee` (from `resolveUsers`), `handoff { reason, by, at }`, `agentPaused` / `agentPausedOn`, `hasPendingDraft`, `accountActive` and `tags`. `InboxMessage` adds `internal`, `systemLine`, `draft`, `handoffAfterDraft`, `approvedBy`, `edited`, `origin`, `source` and `tokensIn` / `tokensOut` / `costCents` (admins only).
- Step-in: a person's reply leaves the status and the agent alone and discards the pending draft. Internal notes are never sent and never reach the model.
- Draft mode (`mode: "draft"` or the number's `agentMode`): the agent stores one pending draft per conversation instead of sending; approving after the 24-hour window throws `WindowClosedError`.
- Agent pause: no catch-up on resume; the agent answers from the next inbound message on. `conversation.agent_paused` fires on every change and `conversation.assigned` on every assignment change.
- Handoffs, takes, assignments, returns to the AI, closes and pauses add a system line to the thread (`internal`, sender `system`, `metadata.kind = "system"`). Handoffs use `resolveAssignees` (falling back to `resolveHandoffTargets`), and every entry into `human` calls the rules hook.
- Every agent turn stores `tokensIn` / `tokensOut`, and `costCents` from the provider's cost (OpenRouter), else the new `AgentDefinition.pricing`, else `null`.
- A disconnected number makes `reply`, `note` and `approveDraft` throw `AccountStateError` (`ACCOUNT_STATE`); reads keep working.
- Adapters: `messages.insertOutbound` accepts `status: "sent"` for rows that never go through the transport.

Re-copy `app/(protected)/inbox/actions.ts`, `page.tsx` and `components/sendo/types.ts` from `sendo-inbox`, and configure `resolveRole` in `lib/sendo.ts`. No schema change.
