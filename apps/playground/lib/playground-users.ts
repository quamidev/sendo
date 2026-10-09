// The playground's team (stands in for the app's users table): names for `resolveUsers` in
// lib/sendo.ts and `resolveUserNames()` in the inbox config.
import type { TeamUser } from "@quami/sendo";
import { NUMBERS_AGENT_USER_ID } from "@/fixtures/numbers";
import { OTHER_OPERATOR_ID } from "@/fixtures/inbox";
import { FIXTURES_DEV_USER_ID, SUPABASE_DEV_USER_ID } from "@/lib/playground-env";

const PLAYGROUND_USERS: Record<string, string> = {
  [FIXTURES_DEV_USER_ID]: "Ana López",
  [SUPABASE_DEV_USER_ID]: "Ana López",
  [OTHER_OPERATOR_ID]: "Javier Ruiz",
  [NUMBERS_AGENT_USER_ID]: "Rosa Méndez",
};

export function playgroundUsers(ids: string[]): Promise<TeamUser[]> {
  return Promise.resolve(
    ids.flatMap((id) => {
      const name = PLAYGROUND_USERS[id];
      return name === undefined ? [] : [{ id, name }];
    }),
  );
}

export function playgroundUserNames(ids: string[]): Record<string, string> {
  return Object.fromEntries(
    ids.flatMap((id) => {
      const name = PLAYGROUND_USERS[id];
      return name === undefined ? [] : [[id, name]];
    }),
  );
}
