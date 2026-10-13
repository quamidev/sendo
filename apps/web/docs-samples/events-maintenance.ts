import { sendo } from "./sendo";

export async function examples(eventId: string) {
  // #region events
  const event = await sendo.events.get(eventId); // raw payload + status
  if (event?.status === "failed" || event?.status === "unrouted") {
    const after = await sendo.events.reprocess(eventId); // idempotent: messages are deduped
    console.log(after.status, after.error);
  }
  // #endregion events

  // #region prune
  const deleted = await sendo.maintenance.prune(); // eventRetentionDays (default 30)
  await sendo.maintenance.prune({ olderThanDays: 7 });
  // #endregion prune
  return deleted;
}
