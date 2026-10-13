import type { Metadata } from "next";
import { InboxFrame } from "@/components/demo/inbox-frame";
import { seedDemoFixtures } from "@/lib/demo/fixtures";
import { inboxSnapshot } from "@/lib/demo/snapshot";
import { createDemoWorld } from "@/lib/demo/world";
import "@/components/sendo/motion.css";

export const metadata: Metadata = {
  title: "Demo inbox",
  robots: { index: false, follow: false },
};

// The fixture conversations are relative to the render time; refresh them hourly.
export const revalidate = 3600;

/**
 * The demo inbox embedded by `/` and `/demo`: the real `inbox` component on fixtures that
 * the real `sendo.inbox` API computed over the memory adapter at render time.
 */
export default async function DemoInboxFramePage() {
  const world = await createDemoWorld();
  const ids = await seedDemoFixtures(world);
  const fixtures = await inboxSnapshot(world, ids);
  return <InboxFrame fixtures={fixtures} />;
}
