// Load Prettier only on demand; avoid slowing down startup of the desktop editor.
export async function formatMarkdown(source) {
  const [prettier, markdownPlugin] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/markdown'),
  ]);
  return prettier.format(source, {
    parser: 'markdown',
    plugins: [markdownPlugin],
    proseWrap: 'preserve',
    printWidth: 100,
  });
}
