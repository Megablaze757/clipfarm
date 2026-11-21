/**
 * Clipper's email templates (apps/worker/src/clipper/email-templates/*.html).
 *
 * Each email is its own file — edit the wording, button or subject there.
 * The comment at the top of a file sets its Subject and Preview line, and
 * _layout.html wraps every one (logo, card, footer).
 *
 * Placeholders: {{ name }} is HTML-escaped (safe for user data and links),
 * {{{ name }}} is inserted as-is (only used for the layout's content slot).
 *
 * Wrangler bundles .html files as text, so these ship inside the Worker.
 */
import layout from "./email-templates/_layout.html";
import confirmSignup from "./email-templates/confirm-signup.html";
import resetPassword from "./email-templates/reset-password.html";
import signInLink from "./email-templates/sign-in-link.html";
import passwordChanged from "./email-templates/password-changed.html";
import clipsReady from "./email-templates/clips-ready.html";
import adminAlert from "./email-templates/admin-alert.html";
import adminDaily from "./email-templates/admin-daily.html";
import teamInvite from "./email-templates/team-invite.html";

export const TEMPLATES = {
  "confirm-signup": confirmSignup,
  "reset-password": resetPassword,
  "sign-in-link": signInLink,
  "password-changed": passwordChanged,
  "clips-ready": clipsReady,
  "admin-alert": adminAlert,
  "admin-daily": adminDaily,
  "team-invite": teamInvite,
} as const;
export type TemplateName = keyof typeof TEMPLATES;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Fills {{ x }} (escaped) and {{{ x }}} (raw). Unknown placeholders become empty. */
export function fill(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{\{\s*([\w]+)\s*\}\}\}/g, (_m, k) => vars[k] ?? "")
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, k) => escapeHtml(vars[k] ?? ""));
}

/** The Subject: / Preview: lines from a template's header comment. */
export function meta(template: string): { subject: string; preview: string } {
  const head = template.match(/<!--([\s\S]*?)-->/)?.[1] ?? "";
  return {
    subject: head.match(/Subject:\s*(.+)/)?.[1]?.trim() ?? "Clipper",
    preview: head.match(/Preview:\s*(.+)/)?.[1]?.trim() ?? "",
  };
}

/** A readable plain-text part (spam filters and text-only clients want one). */
export function toText(html: string, link?: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|\/p|\/h1|\/div|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#9986;/g, "")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^If the button doesn't work/i.test(l) && l !== link)
    .join("\n\n");
  return link ? `${body}\n\nLink: ${link}` : body;
}

/** Vars fill both the body and the Subject/Preview lines (e.g. "{{ title }} is ready"). */
export function renderEmail(name: TemplateName, vars: { link?: string; email: string; app_url: string; [k: string]: string | undefined }):
  { subject: string; html: string; text: string } {
  const tpl = TEMPLATES[name];
  const strings: Record<string, string> = Object.fromEntries(Object.entries({ ...vars, link: vars.link ?? vars.app_url }).map(([k, v]) => [k, v ?? ""]));
  const plain = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => strings[k] ?? "");
  const { subject: rawSubject, preview: rawPreview } = meta(tpl);
  const subject = plain(rawSubject), preview = plain(rawPreview);
  const content = fill(tpl.replace(/^\s*<!--[\s\S]*?-->\s*/, ""), strings);
  const html = fill(layout, { ...strings, subject, preheader: preview, content });
  return { subject, html, text: toText(content, vars.link) };
}
