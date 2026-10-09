import type { Account, Contact, Conversation, MessageError, TenantId } from "../../types/entities";
import type {
  AccountInsertInput,
  InsertInboundMessageInput,
  InsertOutboundMessageInput,
  TemplateUpsertInput,
  SendoAdapter,
} from "../types";

/** Returns a fresh adapter for one test. */
export type Fresh = () => Promise<SendoAdapter>;

export const NOT_FOUND = { code: "RECORD_NOT_FOUND" };
/** A `ConstraintViolationError` for the named Postgres constraint. */
export const violates = (constraint: string) => ({ code: "CONSTRAINT_VIOLATION", constraint });
export const DUPLICATE_ACCOUNT = { code: "ACCOUNT_EXISTS" };
/** `AccountStateError` for an operation refused on an active account. */
export const ACCOUNT_ACTIVE = { code: "ACCOUNT_STATE", state: "active" };
export const HOUR_MS = 60 * 60 * 1000;

let counter = 0;
export const uid = (): string =>
  `${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
/** Spacing between writes whose `createdAt` order matters, so real databases never tie. */
export const tick = (): Promise<void> => sleep(5);

export const makePhone = (): string => `+5025${digits(7)}`;
export const makeTenantId = (): string => crypto.randomUUID();

/** A WhatsApp account input; `phoneNumberId` and `wabaId` are always set. */
export type WhatsAppAccountInput = AccountInsertInput & { phoneNumberId: string; wabaId: string };

export const makeAccountInput = (
  overrides: Partial<WhatsAppAccountInput> = {},
): WhatsAppAccountInput => ({
  tenantId: null,
  phoneNumberId: `pn${digits(12)}`,
  wabaId: `waba${digits(12)}`,
  displayPhone: "+502 5555 0000",
  tokenRef: "SENDO_TEST_TOKEN",
  ...overrides,
});

export const makeTemplateInput = (
  overrides: Partial<TemplateUpsertInput> = {},
): TemplateUpsertInput => ({
  name: `tpl_${uid()}`,
  language: "es",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hola {{1}}" }],
  variableCount: 1,
  ...overrides,
});

export const makeError = (overrides: Partial<MessageError> = {}): MessageError => ({
  code: 131047,
  title: "Re-engagement message",
  message: "More than 24 hours have passed since the recipient last replied.",
  ...overrides,
});

export interface Seed {
  account: Account;
  contact: Contact;
  conversation: Conversation;
}

export async function seedAccount(
  adapter: SendoAdapter,
  overrides: Partial<AccountInsertInput> = {},
): Promise<Account> {
  return adapter.accounts.insert({ ...makeAccountInput(), ...overrides });
}

export async function seedContact(
  adapter: SendoAdapter,
  account: Account,
  phone: string = makePhone(),
): Promise<Contact> {
  const { contact } = await adapter.contacts.upsert({
    accountId: account.id,
    tenantId: account.tenantId,
    phone,
    waId: phone.slice(1),
    profileName: "Ana López",
  });
  return contact;
}

export async function seedConversation(
  adapter: SendoAdapter,
  opts: { tenantId?: TenantId; account?: Account } = {},
): Promise<Seed> {
  const account = opts.account ?? (await seedAccount(adapter, { tenantId: opts.tenantId ?? null }));
  const contact = await seedContact(adapter, account);
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: contact.id,
    accountId: account.id,
    tenantId: account.tenantId,
  });
  return { account, contact, conversation };
}

export const makeInbound = (
  conversation: Conversation,
  overrides: Partial<InsertInboundMessageInput> = {},
): InsertInboundMessageInput => ({
  tenantId: conversation.tenantId,
  conversationId: conversation.id,
  type: "text",
  content: { body: "Hola" },
  text: "Hola",
  metaMessageId: `wamid.${uid()}`,
  sentAt: new Date("2026-01-15T15:00:00.000Z"),
  ...overrides,
});

export const makeOutbound = (
  conversation: Conversation,
  overrides: Partial<InsertOutboundMessageInput> = {},
): InsertOutboundMessageInput => ({
  tenantId: conversation.tenantId,
  conversationId: conversation.id,
  type: "text",
  content: { body: "Buenas tardes" },
  text: "Buenas tardes",
  sender: "agent",
  senderRef: "recepcion",
  ...overrides,
});

export const makeMetaId = (): string => `wamid.${uid()}`;
