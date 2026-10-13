import { Fragment, type ReactNode } from "react";
import { A, C } from "@/components/docs/prose";

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Renders the inline markup dictionaries may use: `` `code` ``, `**strong**` and
 * `[label](/docs/x)`. Everything else is plain text. Keeps copy as plain strings so the leak
 * test can read every word.
 */
export function rich(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, code, strong, label, href] = match;
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = match.index;
    if (code !== undefined) out.push(<C key={key}>{code}</C>);
    else if (strong !== undefined) out.push(<strong key={key}>{strong}</strong>);
    else if (label !== undefined && href !== undefined)
      out.push(
        <A key={key} href={href}>
          {label}
        </A>,
      );
    last = match.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}

/** Replaces `{name}` placeholders: `interpolate("{n} left", { n: 3 })` → `"3 left"`. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}
