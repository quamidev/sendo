import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SendoLocale } from "@/lib/sendo-ui";
import { widgetsStrings } from "./strings";
import { isValidSource, whatsappLink } from "./whatsapp-link";

export interface SendoChatBubbleProps {
  /**
   * The link from the server, e.g. `(await sendo.links.create({ account, text, source })).url`.
   * Use it when you pick the number by account or tenant instead of by phone.
   */
  href?: string;
  /** The WhatsApp number in any format (`+502 5555-1234`). Ignored when `href` is set. */
  phone?: string;
  /** Prefilled message. */
  text?: string;
  /** Source code appended as `[#source]` (`^[a-z0-9-]{1,32}$`), e.g. `web`. */
  source?: string;
  position?: "bottom-right" | "bottom-left";
  /**
   * The language of your public site's visitors (the bubble's accessible name and tooltip). Pass
   * it explicitly: the public site's language may differ from the admin screens' `sendoLocale`.
   */
  locale: SendoLocale;
  /** Accessible name and tooltip. Default: `bubbleLabel` of `locale` ("Message us on WhatsApp"). */
  label?: string;
  className?: string;
}

/**
 * A floating WhatsApp button for your public site: opens WhatsApp with the message ready.
 * Plain link (no client JS); works in Server and Client Components. Renders nothing when
 * neither `href` nor a valid `phone` is given.
 */
export function SendoChatBubble({
  href,
  phone,
  text,
  source,
  position = "bottom-right",
  locale,
  label = widgetsStrings[locale].bubbleLabel,
  className,
}: SendoChatBubbleProps) {
  if (source !== undefined && !isValidSource(source) && process.env.NODE_ENV !== "production") {
    console.error(`[sendo] SendoChatBubble: invalid source "${source}" (^[a-z0-9-]{1,32}$).`);
  }
  const url = href ?? (phone === undefined ? null : whatsappLink({ phone, text, source }));
  if (url === null) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      data-position={position}
      className={cn(
        "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-50 grid size-14 place-items-center rounded-full bg-[#1fa855] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] outline-none",
        "transition-[transform,background-color] duration-[var(--sendo-dur-press,120ms)] ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]",
        "hover:bg-[#178a45] hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.5)] focus-visible:ring-[3px] focus-visible:ring-[#1fa855]/50 focus-visible:ring-offset-2",
        "active:bg-[#137539] active:[transform:scale(0.94)] motion-reduce:active:[transform:none]",
        position === "bottom-left" ? "left-5" : "right-5",
        className,
      )}
    >
      <MessageCircle aria-hidden className="size-7" strokeWidth={2} />
    </a>
  );
}
