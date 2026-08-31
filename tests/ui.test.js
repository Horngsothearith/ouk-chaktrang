const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/ui.js');
const OukUI = globalThis.OukUI;

// A 180px-tall move list whose content has grown past it. Client rects are in
// viewport coordinates, so the list's own top/bottom move with the page; only
// the offsets between the two rects matter.
function view(scrollTop, opts) {
  opts = opts || {};
  return {
    top: 400,
    bottom: 580,
    scrollTop: scrollTop,
    scrollHeight: opts.scrollHeight === undefined ? 600 : opts.scrollHeight,
    clientHeight: 180
  };
}

// Row `i` of a 24px-per-row list, as it sits on screen for a given scrollTop.
function row(i, scrollTop) {
  const top = 400 + i * 24 - scrollTop;
  return { top: top, bottom: top + 24 };
}

test('the newest move scrolls the list to its bottom', () => {
  // Move 25 has just been appended: 600px of rows in a 180px window.
  assert.equal(OukUI.moveListScrollTop(view(0), row(24, 0), 'last'), 420);
});

test('the newest move needs no scroll while the list still fits', () => {
  const fits = view(0, { scrollHeight: 120 });
  assert.equal(OukUI.moveListScrollTop(fits, row(4, 0), 'last'), 0);
});

test('the first move scrolls the list back to its top', () => {
  // Landing at the row's own offset would scroll the list's padding away and
  // sit move 1 against the border; the top of the list is where it belongs.
  assert.equal(OukUI.moveListScrollTop(view(420), row(0, 420), 'first'), 0);
});

test('a row below the fold scrolls down by exactly its overflow', () => {
  // Row 10 spans 640-664 on screen; the list ends at 580.
  assert.equal(OukUI.moveListScrollTop(view(0), row(10, 0), null), 84);
});

test('a row above the fold scrolls up by exactly its overflow', () => {
  // Scrolled to 300, row 5 sits at 220-244 - 180px above the list's top edge.
  // Its own offset in the content is 5 * 24, which is where the list lands.
  assert.equal(OukUI.moveListScrollTop(view(300), row(5, 300), null), 120);
});

test('a fully visible row leaves the scroll position alone', () => {
  const scrollTop = 200;
  assert.equal(
    OukUI.moveListScrollTop(view(scrollTop), row(9, scrollTop), null),
    scrollTop
  );
});

test('the result stays within the list\'s own scroll range', () => {
  // A row far below the fold cannot scroll past the end of the content...
  assert.equal(OukUI.moveListScrollTop(view(0), row(100, 0), null), 420);
  // ...and one far above it cannot scroll to a negative offset.
  assert.equal(OukUI.moveListScrollTop(view(10), row(-40, 10), null), 0);
});
