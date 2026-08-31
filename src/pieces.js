(function (root) {
  'use strict';

  // Ouk Chaktrang (Khmer Chess) piece glyphs.
  // Each piece is carefully sculpted with authentic Southeast Asian silhouettes:
  // - K (King / Ang / Sdaach): Majestic tiered stupa spire & Mokot crown
  // - Q (Queen / Neang / Met): Noble lotus dome & pearl finial
  // - B (Bishop / Koul / Thom): Angkorian stepped pillar & flared shoulders
  // - N (Knight / Shes): Sculpted Khmer steed with arched neck & notched mane
  // - R (Rook / Touk): Royal barge boat hull with central pavilion canopy
  // - P (Pawn / Kun / Trey): Embossed circular cowrie-shell / lotus token

  var PIECES = {
    // King (Ang / Sdaach) - Tiered royal spire
    K: function (c) {
      return [
        // Base foundation tiers
        '<path d="M18 88 Q50 94 82 88 L79 81 Q50 86 21 81 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        '<path d="M24 81 Q50 86 76 81 L73 74 Q50 78 27 74 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Lower throne waist
        '<path d="M29 74 Q50 78 71 74 L67 58 Q50 62 33 58 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Spire tier 1 (mid collar)
        '<path d="M34 58 Q50 62 66 58 L62 45 Q50 48 38 45 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Spire tier 2 (upper collar)
        '<path d="M39 45 Q50 48 61 45 L57 33 Q50 36 43 33 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Spire tier 3 & finial spire
        '<path d="M44 33 Q50 35 56 33 L54 22 L46 22 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Pointed crown lotus bud peak
        '<path d="M50 8 C45 14 43 18 45 22 L55 22 C57 18 55 14 50 8 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        '<circle cx="50" cy="8" r="2" fill="' + c.detail + '"/>',
        // Shading and depth accents
        '<path d="M50 10 L50 88" stroke="' + c.detail + '" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>',
        '<path d="M36 66 Q50 70 64 66" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.75"/>',
        '<path d="M41 52 Q50 55 59 52" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.75"/>',
        '<path d="M44 39 Q50 41 56 39" stroke="' + c.detail + '" stroke-width="1.5" fill="none" opacity="0.75"/>'
      ].join('');
    },

    // Queen (Neang / Met) - Noble lotus dome & pearl finial
    Q: function (c) {
      return [
        // Base foundation
        '<path d="M22 88 Q50 94 78 88 L75 80 Q50 85 25 80 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Flared lower bell
        '<path d="M27 80 C30 67 36 56 40 48 L60 48 C64 56 70 67 73 80 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Rounded Lotus Dome
        '<path d="M35 48 C35 32 42 22 50 22 C58 22 65 32 65 48 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Lotus Pearl finial
        '<circle cx="50" cy="16" r="4.5" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5"/>',
        '<path d="M50 9 L52 12 L48 12 Z" fill="' + c.detail + '"/>',
        // Inner petal engravings & highlights
        '<path d="M50 22 C45 30 42 39 42 48" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.75"/>',
        '<path d="M50 22 C55 30 58 39 58 48" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.75"/>',
        '<path d="M37 48 Q50 52 63 48" stroke="' + c.detail + '" stroke-width="2" fill="none" opacity="0.8"/>',
        '<path d="M33 66 Q50 71 67 66" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.75"/>'
      ].join('');
    },

    // Bishop (Koul / Thom) - Stepped Angkorian pillar & elephant tusk shoulders
    B: function (c) {
      return [
        // Base foundation
        '<path d="M20 88 Q50 94 80 88 L77 80 Q50 85 23 80 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Upright fluted pillar
        '<path d="M26 80 L30 52 Q50 56 70 52 L74 80 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Flared shoulder wings & notched crown
        '<path d="M30 52 C22 44 24 33 36 30 L38 22 Q50 20 62 22 L64 30 C76 33 78 44 70 52 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Pointed crown apex
        '<path d="M43 22 L50 12 L57 22 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        '<circle cx="50" cy="11" r="2.2" fill="' + c.detail + '"/>',
        // Pillar fluting & collar details
        '<path d="M37 54 L35 79" stroke="' + c.detail + '" stroke-width="1.8" opacity="0.7"/>',
        '<path d="M50 55 L50 80" stroke="' + c.detail + '" stroke-width="1.8" opacity="0.7"/>',
        '<path d="M63 54 L65 79" stroke="' + c.detail + '" stroke-width="1.8" opacity="0.7"/>',
        '<path d="M32 52 Q50 56 68 52" stroke="' + c.detail + '" stroke-width="2" fill="none" opacity="0.8"/>',
        '<circle cx="50" cy="36" r="3.5" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="1.8"/>'
      ].join('');
    },

    // Knight (Shes) - Carved Khmer steed with flowing mane
    N: function (c) {
      return [
        // Base foundation
        '<path d="M22 88 Q50 94 78 88 L75 81 Q50 86 25 81 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Steed silhouette with arched neck and notched mane
        '<path d="M28 81 C27 71 21 60 21 47 C21 38 25 33 30 33 C34 33 37 36 41 34 C44 32 45 26 43 17 C47 18 51 22 52 26 C55 21 58 17 61 14 C62 19 61 24 60 28 C67 31 72 38 73 48 C75 58 73 70 69 81 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Scalloped mane ridges along the neck crest
        '<path d="M60 28 Q67 32 63 38 Q71 43 66 50 Q74 56 68 64 Q74 72 69 81" fill="none" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Facial carvings (eye, brow, muzzle, chest harness)
        '<circle cx="34" cy="39" r="2.5" fill="' + c.detail + '"/>',
        '<path d="M22 45 Q26 47 31 44" stroke="' + c.stroke + '" stroke-width="2" fill="none" stroke-linecap="round"/>',
        '<path d="M25 61 Q37 67 48 62" stroke="' + c.detail + '" stroke-width="2.2" fill="none" opacity="0.85"/>',
        '<path d="M43 34 C48 42 53 52 54 66" stroke="' + c.detail + '" stroke-width="1.8" fill="none" opacity="0.7"/>'
      ].join('');
    },

    // Rook (Touk) - Royal barge boat hull & fortress temple canopy
    R: function (c) {
      return [
        // Swept royal boat hull
        '<path d="M12 66 C20 78 33 88 50 88 C67 88 80 78 88 66 C76 73 63 77 50 77 C37 77 24 73 12 66 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Lower deck platform
        '<path d="M20 66 L80 66 L77 57 L23 57 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Temple pavilion tower walls
        '<path d="M29 57 L29 36 L71 36 L71 57 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Crenellated temple canopy & stepped eaves
        '<path d="M25 36 L25 24 L33 24 L33 30 L43 30 L43 24 L57 24 L57 30 L67 30 L67 24 L75 24 L75 36 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        // Central pavilion spire peak
        '<path d="M43 24 L50 14 L57 24 Z" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5" stroke-linejoin="round"/>',
        '<circle cx="50" cy="12" r="2.2" fill="' + c.detail + '"/>',
        // Pavilion window arch & hull planking lines
        '<path d="M43 42 C43 37 50 34 50 34 C50 34 57 37 57 42 L57 53 L43 53 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="1.8"/>',
        '<path d="M22 72 Q50 81 78 72" stroke="' + c.detail + '" stroke-width="2" fill="none" opacity="0.85"/>'
      ].join('');
    },

    // Pawn (Kun / Trey) - Embossed Cowrie-shell / Lotus token
    P: function (c) {
      return [
        // Outer medallion drop base
        '<circle cx="50" cy="54" r="33" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2.5"/>',
        // Main raised token face
        '<circle cx="50" cy="50" r="33" fill="' + c.base + '" stroke="' + c.stroke + '" stroke-width="2.5"/>',
        // Stepped inner bevel ring
        '<circle cx="50" cy="50" r="25" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2" opacity="0.9"/>',
        '<circle cx="50" cy="50" r="19" fill="' + c.base + '" stroke="' + c.detail + '" stroke-width="1.8"/>',
        // Central Cowrie-shell / Lotus motif
        '<path d="M50 36 C43 36 39 42 39 50 C39 58 43 64 50 64 C57 64 61 58 61 50 C61 42 57 36 50 36 Z" fill="' + c.shade + '" stroke="' + c.stroke + '" stroke-width="2" stroke-linejoin="round"/>',
        // Cowrie tooth slit & ridges
        '<path d="M50 37 Q48 50 50 63" stroke="' + c.detail + '" stroke-width="2" fill="none"/>',
        '<path d="M43 45 L57 45 M42 50 L58 50 M43 55 L57 55" stroke="' + c.detail + '" stroke-width="1.8" stroke-linecap="round"/>',
        // Outer cardinal decorative bead accents
        '<circle cx="50" cy="23" r="2" fill="' + c.detail + '"/>',
        '<circle cx="50" cy="77" r="2" fill="' + c.detail + '"/>',
        '<circle cx="23" cy="50" r="2" fill="' + c.detail + '"/>',
        '<circle cx="77" cy="50" r="2" fill="' + c.detail + '"/>'
      ].join('');
    }
  };

  // Handcrafted piece skins tailored for contrast and authentic Southeast Asian aesthetic.
  var SKINS = {
    'ivory-teak': {
      id: 'ivory-teak',
      name: 'Ivory & Teak',
      nameKm: 'ភ្លុក & ឈើប្រណិត',
      w: {
        base: '#fbf4df',    // Warm ivory / light boxwood
        shade: '#e6d3a5',   // Warm honey shadow tone
        stroke: '#6e4c16',  // Deep antique gold / bronze outline
        detail: '#8f6826'   // Engraved accent tone
      },
      b: {
        base: '#3c2719',    // Polished dark teak / ebony
        shade: '#23150c',   // Deep charred wood shadow
        stroke: '#100804',  // Midnight charcoal outline
        detail: '#c8a27a'   // Warm sandalwood/copper rim highlight
      }
    },
    'gold-bronze': {
      id: 'gold-bronze',
      name: 'Gold & Antique Bronze',
      nameKm: 'មាស & សំរឹទ្ធ',
      w: {
        base: '#ffe99c',    // Gleaming royal gold
        shade: '#d6b038',   // Rich gold shadow
        stroke: '#6b4d0e',  // Deep bronze boundary
        detail: '#946f1e'   // Gilt luster accents
      },
      b: {
        base: '#2f3b35',    // Patinated antique bronze
        shade: '#1c2420',   // Deep oxidized green-black
        stroke: '#0e1411',  // Obsidian rim
        detail: '#7da38d'   // Ancient verdigris highlight
      }
    },
    'jade-ruby': {
      id: 'jade-ruby',
      name: 'Imperial Jade & Ruby',
      nameKm: 'ត្បូងមរកត & ត្បូងទទឹម',
      w: {
        base: '#e3f5ed',    // Celadon pale white jade
        shade: '#b5e0ca',   // Soft mint jade contour
        stroke: '#215c3c',  // Deep pine jade outline
        detail: '#3f875f'   // Imperial emerald carvings
      },
      b: {
        base: '#4f141f',    // Deep polished ruby stone
        shade: '#2c080f',   // Dark burgundy shadow
        stroke: '#170307',  // Crimson soot contour
        detail: '#e66b7c'   // Bright ruby glint
      }
    },
    'sandstone': {
      id: 'sandstone',
      name: 'Bayon Sandstone & Basalt',
      nameKm: 'ថ្មភក់ & ថ្មបាសាល់',
      w: {
        base: '#f6ecdd',    // Sunlit Angkor sandstone
        shade: '#dbcaa9',   // Weathered porous stone shadow
        stroke: '#66533a',  // Earthy ochre outline
        detail: '#927956'   // Carved relief lines
      },
      b: {
        base: '#303236',    // Ancient volcanic basalt
        shade: '#1c1d20',   // Dark charcoal cavity
        stroke: '#0b0c0e',  // Basalt edge
        detail: '#9ea2aa'   // Light mineral dusting
      }
    },
    'modern': {
      id: 'modern',
      name: 'Modern Minimalist',
      nameKm: 'ស & ខ្មៅ ទំនើប',
      w: {
        base: '#ffffff',    // Crisp ceramic white
        shade: '#e2e8f0',   // Cool steel shadow
        stroke: '#334155',  // Slate contour
        detail: '#64748b'   // Clean metallic accents
      },
      b: {
        base: '#1e293b',    // Matte midnight carbon
        shade: '#0f172a',   // Deep carbon shadow
        stroke: '#020617',  // Pitch rim
        detail: '#94a3b8'   // Sharp titanium highlight
      }
    }
  };

  var currentSkin = 'ivory-teak';
  var PALETTES = SKINS['ivory-teak'];

  function setSkin(skinId) {
    if (SKINS[skinId]) {
      currentSkin = skinId;
      PALETTES = SKINS[skinId];
      return true;
    }
    return false;
  }

  function getSkin() {
    return currentSkin;
  }

  function getAvailableSkins() {
    return Object.keys(SKINS).map(function (key) {
      return {
        id: SKINS[key].id,
        name: SKINS[key].name,
        nameKm: SKINS[key].nameKm
      };
    });
  }

  function svgFor(type, color, customSkin) {
    var renderer = PIECES[type];
    if (!renderer) return '';
    var activeSkin = (customSkin && SKINS[customSkin]) ? SKINS[customSkin] : (SKINS[currentSkin] || SKINS['ivory-teak']);
    var palette = activeSkin[color] || activeSkin.w;
    var innerContent = renderer(palette);
    return '<svg viewBox="0 0 100 100" class="oc-piece" xmlns="http://www.w3.org/2000/svg">' + innerContent + '</svg>';
  }

  var api = {
    svgFor: svgFor,
    setSkin: setSkin,
    getSkin: getSkin,
    getAvailableSkins: getAvailableSkins,
    SKINS: SKINS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OukPieces = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
