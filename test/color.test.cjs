const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../out/color');

test('requested backgrounds remain exact, foreground is AA, hover has correct direction', () => {
  for (const hex of ['#000000','#FFFFFF','#FFFF00','#FF0000','#00FF00','#0000FF','#808080','#344D42']) {
    const colors = c.deriveColors(hex);
    const fg = colors['statusBar.foreground'], hover = colors['statusBarItem.hoverBackground'];
    assert.equal(colors['statusBar.background'], hex);
    assert.ok(c.contrastRatio(hex, fg) >= 4.5, hex);
    const baseLab = c.rgbToOklch(c.hexToRgb(hex));
    const hoverLab = c.rgbToOklch(c.hexToRgb(hover));
    assert.ok(baseLab.l < .65 ? hoverLab.l > baseLab.l : hoverLab.l < baseLab.l, hex);
    if (baseLab.c > .02) {
      const hueDifference = Math.abs(Math.atan2(Math.sin(baseLab.h-hoverLab.h), Math.cos(baseLab.h-hoverLab.h)));
      assert.ok(hueDifference < .05, `${hex}: hue shift ${hueDifference}`);
    }
    if (['#FFFF00', '#FFFFFF'].includes(hex)) assert.ok(c.rgbToOklch(c.hexToRgb(fg)).l < .3);
    if (hex === '#000000') { assert.equal(fg, '#F2F2F2'); assert.ok(hoverLab.l > .2); }
  }
});

test('foreground inherits hue with restrained chroma and preserves contrast', () => {
  for (const hex of ['#344D42', '#123456', '#8956AE', '#FFFF00', '#FF00FF']) {
    const fg = c.deriveColors(hex)['statusBar.foreground'];
    const base = c.rgbToOklch(c.hexToRgb(hex)), tint = c.rgbToOklch(c.hexToRgb(fg));
    assert.ok(tint.c > .008 && tint.c < .045, `${hex}: ${fg}`);
    assert.ok(Math.abs(Math.atan2(Math.sin(base.h - tint.h), Math.cos(base.h - tint.h))) < .15);
    const neutralContrast = Math.max(c.contrastRatio(hex, '#161616'), c.contrastRatio(hex, '#F2F2F2'));
    assert.ok(c.contrastRatio(hex, fg) >= Math.max(4.5, neutralContrast * .85));
  }
  for (const hex of ['#000000', '#808080', '#FFFFFF']) {
    const rgb = c.hexToRgb(c.deriveColors(hex)['statusBar.foreground']);
    assert.equal(rgb[0], rgb[1]); assert.equal(rgb[1], rgb[2]);
  }
});

test('HEX validation and shorthand', () => {
  assert.equal(c.normalizeHex('#aBc'), '#AABBCC');
  for (const value of [null, 42, '#12345', '#12345678', 'red', '#GGGGGG', ' #123456']) {
    assert.throws(() => c.normalizeHex(value), /valid HEX/);
  }
});

test('conversion round trips and AA contrast over RGB grid', () => {
  assert.equal(c.contrastRatio('#000000', '#FFFFFF'), 21);
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const rgb = [r/255, g/255, b/255], hex = c.rgbToHex(rgb);
    assert.equal(c.rgbToHex(c.oklchToRgb(c.rgbToOklch(rgb))), hex);
    const derived = c.deriveColors(hex);
    assert.ok(c.contrastRatio(hex, derived['statusBar.foreground']) >= 4.5);
  }
  assert.equal(c.inSrgbGamut([1.1, 0, 0]), false);
});

test('random colors are valid, reasonably bright and distinct', () => {
  for (let i = 0; i < 200; i++) {
    const color = c.randomColor('#34845B');
    assert.equal(c.normalizeHex(color), color);
    assert.notEqual(color, '#34845B');
    assert.ok(c.rgbToOklch(c.hexToRgb(color)).l > .35);
  }
});
