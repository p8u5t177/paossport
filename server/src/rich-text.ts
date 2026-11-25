import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
];

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert legacy plain-text captions into safe paragraph HTML. */
export function plainTextToHtml(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const withBreaks = escapeHtml(block).replace(/\n/g, "<br />");
      return `<p>${withBreaks}</p>`;
    })
    .join("");
}

export function sanitizeContentHtml(input: string | null | undefined) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "rel", "target"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      b: "strong",
      i: "em",
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  }).trim();
}

/** Plain-text excerpt for feed cards, admin lists, and fallback titles. */
export function htmlToPlainText(html: string) {
  if (!html.trim()) return "";
  const withBreaks = html
    .replace(/<\/(p|h2|h3|li|div|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return stripped
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function looksLikeStoryHtml(value: string) {
  return /<\/?(p|h2|h3|ul|ol|li|em|strong|a|br)\b/i.test(value);
}

export function normalizeStoryContent(input: string | null | undefined) {
  const contentHtml = sanitizeContentHtml(input);
  return {
    contentHtml,
    caption: htmlToPlainText(contentHtml),
  };
}

/** Accept either rich HTML or legacy plain text into story fields. */
export function normalizeStoryInput(input: string | null | undefined) {
  const raw = String(input ?? "");
  if (!raw.trim()) return { contentHtml: "", caption: "" };
  if (looksLikeStoryHtml(raw)) return normalizeStoryContent(raw);
  return normalizeStoryContent(plainTextToHtml(raw));
}
