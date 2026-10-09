import type { SendoContext } from "../context";
import { createContactsService, type ContactsService } from "./contacts";
import { createConversationsService, type ConversationsService } from "./conversations";
import { createMessagesService, type MessagesService } from "./messages";
import { createTemplatesService, type TemplatesService } from "./templates";

export * from "./contacts";
export * from "./conversations";
export * from "./messages";
export * from "./templates";

/** Shared operations used by the public namespaces, the pipeline, agents and inbox. */
export interface SendoServices {
  contacts: ContactsService;
  conversations: ConversationsService;
  messages: MessagesService;
  templates: TemplatesService;
}

/** Services only read `ctx` at call time, so `ctx.services` may be assigned afterwards. */
export function createServices(ctx: SendoContext): SendoServices {
  return {
    contacts: createContactsService(ctx),
    conversations: createConversationsService(ctx),
    messages: createMessagesService(ctx),
    templates: createTemplatesService(ctx),
  };
}
