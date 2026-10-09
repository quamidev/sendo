import { wa } from "./whatsapp";

export async function examples(eventId: string) {
  // #region events
  const event = await wa.events.get(eventId); // raw payload + status
  if (event?.status === "failed" || event?.status === "unrouted") {
    const after = await wa.events.reprocess(eventId); // idempotent: messages are deduped
    console.log(after.status, after.error);
  }
  // #endregion events

  // #region prune
  const deleted = await wa.maintenance.prune(); // eventRetentionDays (default 30)
  await wa.maintenance.prune({ olderThanDays: 7 });
  // #endregion prune
  return deleted;
}
