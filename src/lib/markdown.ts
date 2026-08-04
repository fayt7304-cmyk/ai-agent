// A small, dependency-free Markdown -> HTML renderer, scoped to what
// Mistral's replies actually use: headings, bold/italic, inline code,
// code blocks, links, and (numbered/bulleted) lists. Not a full CommonMark
// implementation — deliberately simple and safe (everything is escaped
// before any tag is added back in).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // images: ![alt](url) — handle before the plain-link rule below, since a plain "!"
  // in front of a link would otherwise just fall through untouched. Real generated
  // images already arrive as attachments on the message, so a reference here is only
  // ever the model naming a file — render it if it's an actual loadable URL, otherwise
  // drop the dead markdown (a bare filename) rather than showing it as broken text.
  out = out.replace(/!\[([^\]]*)\]\((https?:|data:)([^\s)]+)\)/g, (_m, scheme, rest) => {
    const src = `${scheme}${rest}`;
    return `<img src="${src}" alt="" class="msg-inline-image" loading="lazy">`;
  });
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");
  // bold + italic (order matters: bold before single-star italic)
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  // links: [text](url) — only http(s) to avoid javascript: URLs
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;

  function closeList() {
    if (listType) {
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      closeList();
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // headings
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = Math.min(headingMatch[1].length + 2, 6); // keep headings visually modest inside a chat bubble
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // bullet list
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInline(bulletMatch[1])}</li>`);
      i++;
      continue;
    }

    // numbered list
    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numberedMatch) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInline(numberedMatch[1])}</li>`);
      i++;
      continue;
    }

    closeList();

    if (!line.trim()) {
      i++;
      continue;
    }

    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }
  closeList();

  return html.join("");
}
