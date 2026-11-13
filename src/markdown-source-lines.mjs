export function annotateMarkdownSourceLines(tokens) {
  for (const token of tokens) {
    if (token.block && token.map && (token.nesting === 1 || token.type === 'code_block')) {
      token.attrSet('data-source-line', String(token.map[0] + 1));
    }
  }
  return tokens;
}
