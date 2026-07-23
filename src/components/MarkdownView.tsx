import { Fragment, type ReactNode } from 'react';
import { Box, Divider, Link, Typography } from '@mui/material';

// Small, dependency-free markdown renderer for the gateway walkthroughs (which
// this project authors, so the feature set is known and bounded): ATX headings,
// paragraphs, ordered/unordered lists, fenced code blocks, blockquotes, thematic
// breaks, and inline **bold** / _italic_ / `code` / [links](url). Unknown syntax
// degrades to plain text rather than throwing.

/* ------------------------------- inline ---------------------------------- */

// Source only — a fresh RegExp is created per call so the stateful `lastIndex`
// is never shared across renderInline's recursion (that would corrupt the loop).
// Alternatives, in order: `code`, **bold**, [text](url), bare URL, _italic_.
// The [text](url) alt precedes the bare-URL alt so a markdown link's inner URL
// isn't matched on its own.
const INLINE_SRC =
  '(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\[[^\\]]+\\]\\([^)]+\\))|((?:https?|wss?)://[^\\s"\')]+)|(_[^_]+_)';

const URL_RE = /^(?:https?|wss?):\/\//;

const codeSx = {
  px: 0.5,
  py: 0.15,
  borderRadius: 0.5,
  bgcolor: 'action.hover',
  fontFamily:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.85em',
};

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_SRC, 'g');
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith('`')) {
      out.push(<Box component="code" key={key} sx={codeSx}>{token.slice(1, -1)}</Box>);
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      out.push(
        mm ? (
          <Link key={key} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</Link>
        ) : (
          token
        ),
      );
    } else if (URL_RE.test(token)) {
      // Bare URL. Peel trailing sentence punctuation back into the text, and
      // skip template URLs with <placeholder> markers (not real links).
      const trail = (token.match(/[.,;:!?]+$/) ?? [''])[0];
      const url = trail ? token.slice(0, -trail.length) : token;
      if (url.includes('<') || url.includes('>')) {
        out.push(token);
      } else {
        out.push(
          <Link key={key} href={url} target="_blank" rel="noopener noreferrer">{url}</Link>,
        );
        if (trail) out.push(trail);
      }
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* -------------------------------- blocks --------------------------------- */

const HEADING_VARIANT: Record<number, 'h6' | 'subtitle1' | 'subtitle2'> = {
  1: 'h6',
  2: 'subtitle1',
  3: 'subtitle2',
};

export interface MarkdownViewProps {
  source: string;
}

export function MarkdownView({ source }: MarkdownViewProps) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `md-${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // blank
    if (trimmed === '') { i++; continue; }

    // fenced code block
    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <Box
          key={nextKey()}
          component="pre"
          sx={{
            m: 0, p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider',
            bgcolor: 'action.hover', overflowX: 'auto',
            fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13, lineHeight: '20px',
          }}
        >
          {body.join('\n')}
        </Box>,
      );
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <Typography
          key={nextKey()}
          variant={HEADING_VARIANT[level] ?? 'subtitle2'}
          sx={{ fontWeight: 600, mt: level <= 2 ? 1 : 0.5 }}
        >
          {renderInline(h[2], nextKey())}
        </Typography>,
      );
      i++;
      continue;
    }

    // thematic break
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<Divider key={nextKey()} />);
      i++;
      continue;
    }

    // blockquote (consecutive > lines)
    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <Box
          key={nextKey()}
          sx={{ borderLeft: 3, borderColor: 'divider', pl: 1.5, color: 'text.secondary' }}
        >
          <Typography variant="body2">{renderInline(quote.join(' '), nextKey())}</Typography>
        </Box>,
      );
      continue;
    }

    // unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <Box key={nextKey()} component="ul" sx={{ my: 0, pl: 3 }}>
          {items.map((it, n) => (
            <li key={n}>
              <Typography variant="body2" component="span">{renderInline(it, `${nextKey()}-${n}`)}</Typography>
            </li>
          ))}
        </Box>,
      );
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <Box key={nextKey()} component="ol" sx={{ my: 0, pl: 3 }}>
          {items.map((it, n) => (
            <li key={n}>
              <Typography variant="body2" component="span">{renderInline(it, `${nextKey()}-${n}`)}</Typography>
            </li>
          ))}
        </Box>,
      );
      continue;
    }

    // paragraph (consecutive non-blank, non-special lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,6})\s/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <Typography key={nextKey()} variant="body2">
        {renderInline(para.join(' '), nextKey())}
      </Typography>,
    );
  }

  return (
    <Box sx={{ '& > * + *': { mt: 1.5 } }}>
      {blocks.map((b, n) => (
        <Fragment key={n}>{b}</Fragment>
      ))}
    </Box>
  );
}
