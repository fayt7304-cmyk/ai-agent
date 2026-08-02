import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// A deliberately simple Markdown -> DOCX converter. It handles the
// structure Mistral OCR actually returns well: headings, bold/italic
// text, and plain paragraphs. Math stays as LaTeX source text (Word
// cannot render LaTeX natively, but the source is preserved and can
// be pasted into a LaTeX/Overleaf document or a Word equation editor).

interface Segment {
  text: string;
  bold?: boolean;
  italics?: boolean;
}

function parseInline(line: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = line;
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*)/;

  while (remaining.length) {
    const match = remaining.match(pattern);
    if (!match || match.index === undefined) {
      segments.push({ text: remaining });
      break;
    }
    if (match.index > 0) {
      segments.push({ text: remaining.slice(0, match.index) });
    }
    if (match[2] !== undefined) {
      segments.push({ text: match[2], bold: true });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], italics: true });
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return segments;
}

export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const lines = markdown.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      paragraphs.push(new Paragraph({ children: [] }));
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingLevel =
        level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      paragraphs.push(
        new Paragraph({
          heading: headingLevel,
          children: parseInline(headingMatch[2]).map(
            (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italics })
          ),
        })
      );
      continue;
    }

    paragraphs.push(
      new Paragraph({
        children: parseInline(line).map((s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italics })),
      })
    );
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(doc);
}
