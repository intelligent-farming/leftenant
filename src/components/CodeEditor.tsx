import { useState, type CSSProperties } from 'react';
import { Box, FormHelperText, InputLabel, Stack } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';

// Two palettes — one per MUI mode. Selected at render time so the syntax
// colors stay legible on whichever background the parent Paper is drawing.
const LIGHT_SYNTAX = {
  comment: '#6b7280',           // slate-500
  string: '#16a34a',            // green-600
  number: '#d97706',            // amber-600
  keyword: '#7c3aed',           // violet-600
  function: '#1e3a5f',          // primary navy (matches theme.ts)
  punctuation: '#475569',       // slate-600
  operator: '#475569',
  builtin: '#0369a1',           // sky-700
  property: '#1e293b',          // slate-800
  regex: '#dc2626',             // red-600
};

const DARK_SYNTAX = {
  comment: '#94a3b8',           // slate-400
  string: '#86efac',            // green-300
  number: '#fbbf24',            // amber-400
  keyword: '#c4b5fd',           // violet-300
  function: '#93c5fd',          // sky-300
  punctuation: '#cbd5e1',       // slate-300
  operator: '#cbd5e1',
  builtin: '#7dd3fc',           // sky-300/400
  property: '#e2e8f0',          // slate-200
  regex: '#fca5a5',             // red-300
};

const FONT_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  helperText?: string;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  language?: 'javascript';      // room for more later (json, etc.)
}

/**
 * Lightweight code editor with JS syntax highlighting. Built on
 * `react-simple-code-editor` (a ~7 KB contenteditable wrapper) and Prism's
 * JavaScript grammar — together ~30 KB minified.
 *
 * Designed to slot into a MUI form alongside `TextField`-style components:
 * label above, helper text below, focused border, monospace body.
 */
export function CodeEditor({
  value, onChange,
  label, helperText, placeholder,
  minRows = 3, maxRows = 16,
  language = 'javascript',
}: CodeEditorProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const syntax = theme.palette.mode === 'dark' ? DARK_SYNTAX : LIGHT_SYNTAX;

  // 14 px line-height × minRows establishes the editor's minimum height; the
  // editor grows past that as content lengthens (no scrollbar until maxRows).
  const lineHeight = 21;
  const padding = 12;
  const minHeight = lineHeight * minRows + padding * 2;
  const maxHeight = lineHeight * maxRows + padding * 2;

  const highlight = (code: string): string => {
    try { return Prism.highlight(code, Prism.languages[language], language); }
    catch { return code; }
  };

  const containerStyle = {
    border: `1px solid ${focused ? theme.palette.primary.main : theme.palette.divider}`,
    borderWidth: focused ? 2 : 1,
    // Compensate for the +1 px border on focus so the editor doesn't jump.
    margin: focused ? 0 : '1px',
    // `borderRadius: 1` in `sx` evaluates to `theme.shape.borderRadius` (8 px
    // by default) — the same rounding MUI's TextField uses. Passing the raw
    // number (8) would be multiplied by the spacing scale and produce 64 px.
    borderRadius: 1,
    backgroundColor: theme.palette.background.paper,
    transition: 'border-color 0.15s, border-width 0s',
  };

  const editorStyle: CSSProperties = {
    fontFamily: FONT_STACK,
    fontSize: 13,
    lineHeight: `${lineHeight}px`,
    minHeight,
    maxHeight,
    overflow: 'auto',
  };

  return (
    <Stack spacing={0.5}>
      {label && <InputLabel shrink sx={{ position: 'static', transform: 'none', fontSize: 12 }}>{label}</InputLabel>}
      <Box sx={containerStyle}>
        <Editor
          value={value}
          onValueChange={onChange}
          highlight={highlight}
          padding={padding}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textareaClassName="cm-textarea"
          style={editorStyle}
          // Bullet-point: tab inserts two spaces. react-simple-code-editor's
          // default is a literal `\t` which renders huge on most font stacks.
          tabSize={2}
          insertSpaces
        />
      </Box>
      {helperText && <FormHelperText sx={{ mx: 1.5 }}>{helperText}</FormHelperText>}
      <style>{`
        /* Inline Prism token colours — scoped to react-simple-code-editor's
           rendered <pre> via its default class. Inlined here so we don't have
           to add a CSS loader entry just for prism's own theme bundle. */
        .npm__react-simple-code-editor__textarea { caret-color: ${theme.palette.text.primary}; }
        .token.comment, .token.prolog, .token.doctype, .token.cdata { color: ${syntax.comment}; font-style: italic; }
        .token.punctuation { color: ${syntax.punctuation}; }
        .token.property, .token.tag, .token.constant, .token.symbol, .token.deleted { color: ${syntax.property}; }
        .token.boolean, .token.number { color: ${syntax.number}; }
        .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: ${syntax.string}; }
        .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string, .token.variable { color: ${syntax.operator}; }
        .token.atrule, .token.attr-value, .token.function, .token.class-name { color: ${syntax.function}; }
        .token.keyword { color: ${syntax.keyword}; font-weight: 500; }
        .token.regex, .token.important { color: ${syntax.regex}; }
        .token.important, .token.bold { font-weight: bold; }
        .token.italic { font-style: italic; }
      `}</style>
    </Stack>
  );
}
