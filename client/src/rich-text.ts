const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "A", "UL", "OL", "LI", "H2", "H3"]);

function isSafeHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("#")) return true;
  return /^(https?:|mailto:)/i.test(trimmed);
}

/** Sanitize story HTML for safe rendering in the feed and detail pages. */
export function sanitizeStoryHtml(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  const template = document.createElement("template");
  template.innerHTML = raw;

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (el.tagName === "A" && (name === "href" || name === "rel" || name === "target")) continue;
          el.removeAttribute(attr.name);
        }
        if (el.tagName === "A") {
          const href = el.getAttribute("href") || "";
          if (!isSafeHref(href)) el.removeAttribute("href");
          el.setAttribute("rel", "noopener noreferrer");
          el.setAttribute("target", "_blank");
        }
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
      }
    }
  };

  walk(template.content);
  return template.innerHTML.trim();
}

export function looksLikeStoryHtml(value: string) {
  return /<\/?(p|h2|h3|ul|ol|li|em|strong|a|br)\b/i.test(value);
}

/** Plain-text excerpt with spaces between block boundaries. */
export function storyHtmlToPlainText(html: string) {
  if (!html.trim()) return "";
  const withBreaks = html
    .replace(/<\/(p|h2|h3|li|div)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "");
  return withBreaks
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Prefer contentHtml; fall back to HTML stored in caption on older APIs. */
export function resolveStoryHtml(post: { contentHtml?: string; caption: string }) {
  if (post.contentHtml?.trim()) return sanitizeStoryHtml(post.contentHtml);
  if (looksLikeStoryHtml(post.caption)) return sanitizeStoryHtml(post.caption);
  return "";
}

function escapeText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Load existing story HTML into the editor, including older caption-only posts. */
export function storyToEditorHtml(post: { contentHtml?: string; caption: string }) {
  if (post.contentHtml?.trim()) return post.contentHtml;
  if (looksLikeStoryHtml(post.caption)) return post.caption;
  const plain = post.caption.trim();
  if (!plain) return "";
  return plain
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeText(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
