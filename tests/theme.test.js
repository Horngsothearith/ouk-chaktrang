const test = require('node:test');
const assert = require('node:assert/strict');
const OukPieces = require('../src/pieces.js');

test('OukPieces exports getAvailableSkins with all 5 handcrafted skins', () => {
  const skins = OukPieces.getAvailableSkins();
  assert.equal(skins.length, 5);
  const ids = skins.map(s => s.id);
  assert.deepEqual(ids, ['ivory-teak', 'gold-bronze', 'jade-ruby', 'sandstone', 'modern']);
  
  // Verify all skins have name and Khmer name
  skins.forEach(s => {
    assert.ok(s.name && s.name.length > 0, `Skin ${s.id} should have a valid name`);
    assert.ok(s.nameKm && s.nameKm.length > 0, `Skin ${s.id} should have a valid Khmer name`);
  });
});

test('OukPieces getSkin and setSkin work properly', () => {
  assert.equal(OukPieces.getSkin(), 'ivory-teak');

  const setGold = OukPieces.setSkin('gold-bronze');
  assert.equal(setGold, true);
  assert.equal(OukPieces.getSkin(), 'gold-bronze');

  const setInvalid = OukPieces.setSkin('non-existent-skin');
  assert.equal(setInvalid, false);
  assert.equal(OukPieces.getSkin(), 'gold-bronze');

  // Reset back to default
  OukPieces.setSkin('ivory-teak');
  assert.equal(OukPieces.getSkin(), 'ivory-teak');
});

test('OukPieces.svgFor renders valid SVG for all piece types and colors in each skin', () => {
  const pieceTypes = ['K', 'Q', 'B', 'N', 'R', 'P'];
  const colors = ['w', 'b'];
  const skins = ['ivory-teak', 'gold-bronze', 'jade-ruby', 'sandstone', 'modern'];

  skins.forEach(skinId => {
    OukPieces.setSkin(skinId);
    pieceTypes.forEach(type => {
      colors.forEach(color => {
        const svg = OukPieces.svgFor(type, color);
        assert.ok(svg.startsWith('<svg'), `Piece ${color}${type} in skin ${skinId} should start with <svg`);
        assert.ok(svg.endsWith('</svg>'), `Piece ${color}${type} in skin ${skinId} should end with </svg>`);
        assert.ok(svg.includes('class="oc-piece"'), `Piece ${color}${type} in skin ${skinId} should have oc-piece class`);
      });
    });
  });

  // Verify custom skin override argument works without altering global skin
  OukPieces.setSkin('ivory-teak');
  const customSvg = OukPieces.svgFor('K', 'w', 'jade-ruby');
  assert.ok(customSvg.includes('#e3f5ed'), 'Custom skin argument should apply the jade-ruby palette base');
  assert.equal(OukPieces.getSkin(), 'ivory-teak');
});
