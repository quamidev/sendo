import {
  AmbiguousAccountError,
  MetaApiError,
  TemplateNotFoundError,
  WindowClosedError,
  isWhatsAppError,
} from "@quami/wa-li";
import { wa } from "./whatsapp";

export async function remind(phone: string) {
  // #region handle
  try {
    return await wa.send.text(phone, "¿Seguimos con tu cita?");
  } catch (error) {
    if (error instanceof WindowClosedError) {
      // Free-form text is blocked 24 h after the contact's last message: use a template.
      return wa.send.template(phone, "recordatorio_cita", { language: "es", variables: ["Ana"] });
    }
    if (error instanceof TemplateNotFoundError) console.error(error.templateName, error.language);
    if (error instanceof AmbiguousAccountError) console.error("Pass { account }:", error.candidates);
    if (error instanceof MetaApiError) {
      console.error(error.status, error.metaCode, error.subcode, error.fbtraceId);
    }
    if (isWhatsAppError(error)) {
      // Stable string codes, safe to branch on and to log: error.toJSON() has no cause/stack.
      console.error(error.code, error.toJSON());
    }
    throw error;
  }
  // #endregion handle
}
