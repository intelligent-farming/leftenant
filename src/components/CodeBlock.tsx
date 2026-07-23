import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-json5';

// Read-only, syntax-highlighted code block. Complements CodeEditor (which is an
// editable react-simple-code-editor). Same Prism token palette so highlighting
// is consistent across the app; `json5` covers both strict JSON (Semtech UDP
// global_conf) and the //-commented Basics Station station.conf.

const LIGHT_SYNTAX = {
  comment: '#6b7280',
  string: '#16a34a',
  number: '#d97706',
  keyword: '#7c3aed',
  function: '#1e3a5f',
  punctuation: '#475569',
  operator: '#475569',
  property: '#1e293b',
  regex: '#dc2626',
};

const DARK_SYNTAX = {
  comment: '#94a3b8',
  string: '#86efac',
  number: '#fbbf24',
  keyword: '#c4b5fd',
  function: '#93c5fd',
  punctuation: '#cbd5e1',
  operator: '#cbd5e1',
  property: '#e2e8f0',
  regex: '#fca5a5',
};

const FONT_STACK =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

export interface CodeBlockProps {
  value: string;
  language?: 'json' | 'json5' | 'javascript';
  /** Max height before scrolling. Omit for no cap (renders inline, no scroll). */
  maxHeight?: number;
}

export function CodeBlock({ value, language = 'json', maxHeight = 360 }: CodeBlockProps) {
  const theme = useTheme();
  const syntax = theme.palette.mode === 'dark' ? DARK_SYNTAX : LIGHT_SYNTAX;

  let html = value;
  try {
    const grammar = Prism.languages[language] ?? Prism.languages.json;
    html = Prism.highlight(value, grammar, language);
  } catch {
    /* fall back to the raw text (already escaped by React below via the pre) */
  }

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          fontFamily: FONT_STACK,
          fontSize: 13,
          lineHeight: '20px',
          overflowX: 'auto',
          ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}),
        }}
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </Box>
      <style>{`
        .token.comment, .token.prolog, .token.doctype, .token.cdata { color: ${syntax.comment}; font-style: italic; }
        .token.punctuation { color: ${syntax.punctuation}; }
        .token.property, .token.tag, .token.constant, .token.symbol, .token.deleted { color: ${syntax.property}; }
        .token.boolean, .token.number { color: ${syntax.number}; }
        .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: ${syntax.string}; }
        .token.operator, .token.entity, .token.url, .token.variable { color: ${syntax.operator}; }
        .token.atrule, .token.attr-value, .token.function, .token.class-name { color: ${syntax.function}; }
        .token.keyword, .token.null { color: ${syntax.keyword}; font-weight: 500; }
        .token.regex, .token.important { color: ${syntax.regex}; }
      `}</style>
    </Box>
  );
}
