"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal markdown renderer for chat responses. Handles the subset
 * Claude actually emits in this product:
 *
 *   • **bold**         → <strong>
 *   • *italic*         → <em>
 *   • `inline code`    → <code>
 *   • Lines starting with `- ` or `* ` → bullets
 *   • Blank lines      → paragraph breaks
 *   • All other text   → preserved as-is, with newlines as <br/>
 *
 * Why not react-markdown / marked? They pull a 30+ KB dependency for
 * a feature we use across exactly one component. A 60-line custom
 * tokenizer is more honest about the surface area we actually need.
 *
 * The renderer is deliberately conservative:
 *   - It does NOT parse links, images, headings, or HTML tags. If
 *     Claude ever emits those we'd render the source text verbatim
 *     (no XSS risk because we don't dangerouslySetInnerHTML; React
 *     escapes everything).
 *   - It does NOT support nested lists. A bullet line is just a
 *     single line that begins with `- ` or `* `; nesting via
 *     indentation is treated as plain text.
 *   - Inline parsing is non-greedy and stops at the next matching
 *     marker, so adjacent inline runs don't collide (e.g.
 *     "**a** and **b**" produces two distinct strong runs).
 *
 * Replaces the previous behavior where `{turn.response}` rendered
 * the raw markdown source — users saw literal `**Armchair swap**`
 * with the asterisks visible. After this, the same string renders
 * with bold weight applied to "Armchair swap".
 */

/** Parse an inline string into React nodes. Recognized markers:
 *  - `**text**` → strong
 *  - `*text*`   → em
 *  - `` `text` `` → code
 *  Anything else passes through as text. The function uses a
 *  position cursor + regex find-from-cursor pattern so it doesn't
 *  re-walk already-consumed input. */
function parseInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Match the FIRST opening of any marker. Order matters — `**` must
  // be tried before `*` because `**` is a longer prefix of the same
  // character set.
  const pattern = /(\*\*([\s\S]+?)\*\*)|(\*([\s\S]+?)\*)|(`([^`]+?)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      out.push(text.slice(cursor, match.index));
    }
    if (match[1] !== undefined) {
      // **bold**
      out.push(<strong key={`s-${key++}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      // *italic*
      out.push(<em key={`e-${key++}`}>{match[4]}</em>);
    } else if (match[5] !== undefined) {
      // `code`
      out.push(
        <code
          key={`c-${key++}`}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "0.92em",
            background: "rgba(26, 26, 26, 0.06)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          {match[6]}
        </code>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }
  return out;
}

/**
 * Render a markdown string as React nodes. The rendered tree is a
 * fragment so the caller can wrap or style it freely.
 *
 * Block-level handling:
 *   - Lines beginning with `- ` or `* ` collect into one <ul>.
 *   - Blank lines split paragraphs. Within a paragraph, single
 *     newlines render as `<br/>` so soft line breaks survive.
 *   - Plain text becomes <p>. Inline markdown inside any block runs
 *     through `parseInline`.
 */
export function renderMarkdown(src: string): ReactNode {
  if (!src) return null;
  // Normalize line endings.
  const text = src.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const raw of lines) {
    const line = raw;
    const isBullet = /^\s*[-*]\s+/.test(line);
    const isBlank = /^\s*$/.test(line);

    if (isBlank) {
      if (cur) blocks.push(cur);
      cur = null;
      continue;
    }
    if (isBullet) {
      const itemText = line.replace(/^\s*[-*]\s+/, "");
      if (cur && cur.kind === "ul") cur.items.push(itemText);
      else {
        if (cur) blocks.push(cur);
        cur = { kind: "ul", items: [itemText] };
      }
      continue;
    }
    // Plain line.
    if (cur && cur.kind === "p") cur.lines.push(line);
    else {
      if (cur) blocks.push(cur);
      cur = { kind: "p", lines: [line] };
    }
  }
  if (cur) blocks.push(cur);

  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "ul") {
          return (
            <ul
              key={i}
              style={{
                margin: "6px 0",
                paddingLeft: 18,
                lineHeight: 1.55,
              }}
            >
              {b.items.map((item, j) => (
                <li key={j}>{parseInline(item)}</li>
              ))}
            </ul>
          );
        }
        // p
        return (
          <p
            key={i}
            style={{
              margin: i === 0 ? "0 0 6px 0" : "6px 0",
              lineHeight: 1.55,
            }}
          >
            {b.lines.map((ln, j) => (
              <Fragment key={j}>
                {parseInline(ln)}
                {j < b.lines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
