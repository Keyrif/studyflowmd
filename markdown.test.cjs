// Tests for the Markdown preview renderer (assets/markdown.js).
// Run: node --test markdown.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const context = vm.createContext({ document: { getElementById: () => null } });
vm.runInContext(fs.readFileSync('assets/markdown.js', 'utf8'), context);
const md = (source) => context.renderMarkdown(source);

test('headings, bold, italics, strikethrough and highlights', () => {
  assert.equal(md('# Title'), '<h1>Title</h1>');
  assert.equal(md('### Small'), '<h3>Small</h3>');
  assert.equal(md('**bold** and *italic* and _also_'), '<p><strong>bold</strong> and <em>italic</em> and <em>also</em></p>');
  assert.equal(md('~~gone~~ ==marked=='), '<p><del>gone</del> <mark>marked</mark></p>');
});

test('snake_case words and lone asterisks stay as they are', () => {
  assert.equal(md('use snake_case_names here'), '<p>use snake_case_names here</p>');
  assert.equal(md('5 * 3 = 15'), '<p>5 * 3 = 15</p>');
});

test('lists, nested lists and task lists', () => {
  assert.equal(md('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(md('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
  assert.equal(md('- parent\n  - child\n- next'), '<ul><li>parent<ul><li>child</li></ul></li><li>next</li></ul>');
  assert.match(md('- [x] done\n- [ ] todo'), /<input type="checkbox" disabled checked> done.*<input type="checkbox" disabled > todo/);
});

test('paragraphs keep their line breaks, like Obsidian', () => {
  assert.equal(md('line one\nline two\n\nnew paragraph'), '<p>line one<br>line two</p><p>new paragraph</p>');
});

test('quotes, rules, code and tables', () => {
  assert.equal(md('> quoted **text**'), '<blockquote><p>quoted <strong>text</strong></p></blockquote>');
  assert.equal(md('---'), '<hr>');
  assert.equal(md('use `x = 1` here'), '<p>use <code>x = 1</code> here</p>');
  assert.equal(md('```\n**not bold**\n```'), '<pre><code>**not bold**</code></pre>');
  assert.match(md('| A | B |\n|---|---|\n| 1 | **2** |'), /<th>A<\/th><th>B<\/th>.*<td>1<\/td><td><strong>2<\/strong><\/td>/);
});

test('links work for web addresses only', () => {
  assert.equal(md('[site](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>');
  assert.doesNotMatch(md('[click](javascript:alert(1))'), /<a /);
  assert.equal(md('see [[Other note]]'), '<p>see <span class="md-wikilink">Other note</span></p>');
});

test('nothing in a note can inject HTML or scripts', () => {
  const dangerous = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '# <b onclick="x()">hi</b>',
    '`</code><script>x</script>`',
    '| <i>a</i> | b |\n|---|---|\n| <svg onload=1> | c |',
  ];
  for (const source of dangerous) {
    const html = md(source);
    assert.doesNotMatch(html, /<(script|img|svg|b|i)[\s>]/, source);
    assert.match(html, /&lt;/, source);
  }
});

test('an empty note shows a friendly message', () => {
  assert.match(md('   \n  '), /Nothing to preview yet/);
});

test('formulas are never touched by bold/italic formatting (no KaTeX: shown as code)', () => {
  assert.equal(md('so $a_1 * b_2 * c$ ok'), '<p>so <code>$a_1 * b_2 * c$</code> ok</p>');
  assert.equal(md('$$\n\\frac{a_1}{b_2}\n$$'), '<pre><code>$$\\frac{a_1}{b_2}$$</code></pre>');
  assert.equal(md('$$ x^2 $$'), '<pre><code>$$x^2$$</code></pre>');
});

test('dollar amounts are not formulas', () => {
  assert.equal(md('costs $5 and $10'), '<p>costs $5 and $10</p>');
  assert.equal(md('from $ 3 to $ 4'), '<p>from $ 3 to $ 4</p>');
});

// The same renderer with the real KaTeX loaded, as in the browser.
const withKatex = vm.createContext({ document: { getElementById: () => null } });
withKatex.self = withKatex;
vm.runInContext(fs.readFileSync('assets/vendor/katex/katex.min.js', 'utf8'), withKatex);
vm.runInContext(fs.readFileSync('assets/markdown.js', 'utf8'), withKatex);
const mdk = (source) => withKatex.renderMarkdown(source);

test('with KaTeX, formulas are drawn', () => {
  assert.match(mdk('$x^2$'), /class="katex"/);
  assert.match(mdk('$$\n\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1\n$$'), /<div class="md-math"><span class="katex-display">/);
  // LaTeX KaTeX can't understand shows as plain code, not as red error text.
  assert.equal(mdk('$$\\frac{1}{$$'), '<pre><code>$$\\frac{1}{$$</code></pre>');
  assert.equal(mdk('see $\\notacommand{x}$ here'), '<p>see <code>$\\notacommand{x}$</code> here</p>');
});

test('with KaTeX, formulas cannot inject links or HTML', () => {
  for (const source of ['$\\href{javascript:alert(1)}{x}$', '$\\htmlId{x}{y}$', '$$\\url{javascript:alert(1)}$$', '$<img src=x onerror=1>$']) {
    const html = mdk(source);
    // The LaTeX source may appear as escaped text (KaTeX's hidden annotation), never as markup.
    assert.doesNotMatch(html, /<a[\s>]|href="|<img|\son\w+="|\sid="x"/i, source);
  }
});
