export type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation';

export interface Token {
  kind: TokenKind;
  text: string;
}

const PATTERN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:[ \t]*:)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * Splits pretty-printed JSON into tokens for syntax highlighting.
 * Rendering tokens as React elements avoids injecting raw HTML.
 */
export function tokenizeJson(json: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(json);
  while (match !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'punctuation', text: json.slice(lastIndex, match.index) });
    }

    const [text, stringLike, booleanLike, nullLike, numberLike] = match;
    if (stringLike !== undefined) {
      tokens.push({ kind: stringLike.trimEnd().endsWith(':') ? 'key' : 'string', text });
    } else if (booleanLike !== undefined) {
      tokens.push({ kind: 'boolean', text });
    } else if (nullLike !== undefined) {
      tokens.push({ kind: 'null', text });
    } else if (numberLike !== undefined) {
      tokens.push({ kind: 'number', text });
    }

    lastIndex = match.index + text.length;
    match = PATTERN.exec(json);
  }

  if (lastIndex < json.length) {
    tokens.push({ kind: 'punctuation', text: json.slice(lastIndex) });
  }

  return tokens;
}
