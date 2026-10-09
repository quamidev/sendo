import { RecordNotFoundError } from "../../errors";
import type { RecordEntity } from "../../errors/errors";

export const notFound = (entity: RecordEntity, id: string): RecordNotFoundError =>
  new RecordNotFoundError({ entity, id });

export const ACCOUNT_CONSTRAINTS = [
  "sendo_accounts_default_per_tenant",
  "sendo_accounts_whatsapp_ids",
  "sendo_accounts_channel_check",
  "sendo_accounts_onboarded_via_check",
  "sendo_accounts_agent_mode_check",
] as const;
export const CONTACT_CONSTRAINTS = [
  "sendo_contacts_identity",
  "sendo_contacts_account_id_channel_user_id_key",
] as const;
export const MESSAGE_CONSTRAINTS = ["sendo_messages_internal_draft_check"] as const;
export const SNIPPET_CONSTRAINTS = [
  "sendo_snippets_shortcut_key",
  "sendo_snippets_shortcut_check",
  "sendo_snippets_visibility_check",
  "sendo_snippets_owner_check",
] as const;
export const TAG_CONSTRAINTS = [
  "sendo_tags_name_key",
  "sendo_tags_name_check",
  "sendo_tags_color_check",
] as const;
export const RULE_CONSTRAINTS = ["sendo_rules_type_check", "sendo_rules_origin_check"] as const;
export const BROADCAST_CONSTRAINTS = [
  "sendo_broadcasts_status_check",
  "sendo_broadcasts_rate_per_minute_check",
] as const;
export const RECIPIENT_CONSTRAINTS = ["sendo_broadcast_recipients_status_check"] as const;
