(function (root) {
  'use strict';

  // Original glyphs (not copied from any source): flat geometric shapes
  // evoking the traditional bulbous Makruk/Ouk piece silhouettes, one per
  // type, colored via inline style so a single path works for both sides.
  var PATHS = {
    K: '<circle cx="50" cy="34" r="16"/><path d="M28 90 Q50 58 72 90 Z"/><rect x="44" y="14" width="12" height="14"/>',
    Q: '<circle cx="50" cy="40" r="14"/><path d="M30 90 Q50 64 70 90 Z"/>',
    B: '<circle cx="50" cy="42" r="13"/><path d="M32 90 Q50 66 68 90 Z"/><circle cx="50" cy="20" r="5"/>',
    N: '<path d="M35 90 L40 50 Q30 40 38 22 Q55 18 62 34 L58 50 L68 90 Z"/>',
    R: '<rect x="32" y="26" width="36" height="14"/><path d="M30 90 Q50 62 70 90 Z"/><rect x="32" y="26" width="8" height="8"/><rect x="60" y="26" width="8" height="8"/>',
    P: '<circle cx="50" cy="48" r="15"/><path d="M36 90 Q50 72 64 90 Z"/>'
  };

  function svgFor(type, color) {
    var body = PATHS[type] || '';
    var fill = color === 'w' ? '#f5efe0' : '#3a2a1a';
    var stroke = color === 'w' ? '#7a5c30' : '#1a1008';
    return '<svg viewBox="0 0 100 100" class="oc-piece" style="fill:' + fill + ';stroke:' + stroke + ';stroke-width:3">' + body + '</svg>';
  }

  var api = { svgFor: svgFor };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukPieces = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
