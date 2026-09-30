import {test} from 'node:test';
import assert from 'node:assert';
import {readFileSync} from 'node:fs';

// The fillscreen style is a CSS string built inside content.js, which is a
// content script with no exports. Read the source and pull it out so a
// regression in the declarations themselves is caught here.
const contentSrc = readFileSync(
    new URL('../chrome/content.js', import.meta.url),
    'utf8',
);

function getExpandStyle() {
  const start = contentSrc.indexOf('const expandStyle =');
  assert.ok(start !== -1, 'could not find expandStyle in content.js');
  const end = contentSrc.indexOf('`;', start);
  assert.ok(end !== -1, 'could not find end of expandStyle');
  return contentSrc.slice(start, end);
}

const expandStyle = getExpandStyle();

test('expandStyle resets max-width and max-height', () => {
  // A page-supplied max-* cap is applied on top of width/height: the used size
  // is min(max-width, width). Without these, a site that caps its player box
  // leaves empty space on the right and bottom in fillscreen.
  assert.match(
      expandStyle,
      /max-width:\s*none\s*!important/,
      'max-width must be reset or a site cap wins over width',
  );
  assert.match(
      expandStyle,
      /max-height:\s*none\s*!important/,
      'max-height must be reset or a site cap wins over height',
  );
});

test('expandStyle still forces a full-viewport fixed box', () => {
  for (const decl of [
    'position: fixed',
    'top: 0px',
    'left: 0px',
    'right: 0px',
    'bottom: 0px',
    'width: 100%',
    'height: 100%',
  ]) {
    assert.ok(
        expandStyle.includes(decl),
        `expandStyle lost "${decl}"`,
    );
  }
});
