export type SendoLocale = "es" | "en"; // extend to add a language

/**
 * The language of every Sendo screen (inbox, numbers, broadcasts, metrics, links, rules). Every
 * Sendo UI item ships this same file, and the page templates pass it as `locale`.
 */
export const sendoLocale: SendoLocale = "en"; // or replace with your own resolver
