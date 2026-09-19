export type RGB = [number, number, number];
export type OKLCH = { l: number; c: number; h: number };

export function normalizeHex(value: unknown): string {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
    throw new Error('Enter a valid HEX color: #RRGGBB (or #RGB).');
  }
  return (value.length === 4
    ? '#' + [...value.slice(1)].map(c => c + c).join('')
    : value).toUpperCase();
}

export function hexToRgb(hex: string): RGB {
  const value = normalizeHex(hex);
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as RGB;
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16).padStart(2, '0')).join('').toUpperCase();
}

const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const encoded = (v: number) => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Oklab matrices by Björn Ottosson; cylindrical coordinates retain hue during gamut mapping.
export function rgbToOklch(rgb: RGB): OKLCH {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

export function oklchToRgb({ l, c, h }: OKLCH): RGB {
  const a = c * Math.cos(h), b = c * Math.sin(h);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * ll - 0.7034186147 * m + 1.707614701 * s].map(encoded) as RGB;
}

export function inSrgbGamut(rgb: RGB): boolean {
  return rgb.every(v => Number.isFinite(v) && v >= -1e-7 && v <= 1 + 1e-7);
}

function gamutMappedHex(color: OKLCH): string {
  if (inSrgbGamut(oklchToRgb(color))) { return rgbToHex(oklchToRgb(color)); }
  let low = 0, high = color.c;
  for (let i = 0; i < 24; i++) {
    const c = (low + high) / 2;
    if (inSrgbGamut(oklchToRgb({ ...color, c }))) { low = c; } else { high = c; }
  }
  return rgbToHex(oklchToRgb({ ...color, c: low }));
}

function tintForeground(background: string, neutral: string, base: OKLCH): string {
  if (base.c < 0.005) { return neutral; }
  const light = rgbToOklch(hexToRgb(neutral)).l > 0.5;
  const chroma = Math.min(light ? 0.04 : 0.025, base.c * 0.9);
  // Keep at least 85% of the neutral contrast, and never fall below normal-text AA.
  const minimumContrast = Math.max(4.5, contrastRatio(background, neutral) * 0.85);
  for (let i = 0; i <= 10; i++) {
    const progress = i / 10;
    const candidate = gamutMappedHex({
      l: light ? 0.9 + 0.1 * progress : 0.2 * (1 - progress),
      c: chroma * (1 - progress), h: base.h
    });
    if (contrastRatio(background, candidate) >= minimumContrast) { return candidate; }
  }
  return neutral;
}

export function deriveColors(base: string): Record<string, string> {
  const background = normalizeHex(base);
  const candidates = ['#161616', '#F2F2F2'];
  let foreground = candidates.sort((a, b) => contrastRatio(background, b) - contrastRatio(background, a))[0];
  if (contrastRatio(background, foreground) < 4.5) {
    foreground = contrastRatio(background, '#000000') >= contrastRatio(background, '#FFFFFF') ? '#000000' : '#FFFFFF';
  }
  const color = rgbToOklch(hexToRgb(background));
  foreground = tintForeground(background, foreground, color);
  // Move dark colors toward light, light colors toward dark. Prefer retaining AA on hover.
  const direction = color.l < 0.65 ? 1 : -1;
  let hover = background;
  // Near black, 0.08 yields only #020202; use a larger step for a visible state.
  const step = color.l < 0.18 ? Math.max(0.08, 0.22 - color.l) : 0.08;
  for (const delta of [step, step - 0.01, step - 0.02]) {
    hover = gamutMappedHex({ ...color, l: Math.max(0, Math.min(1, color.l + direction * delta)) });
    if (contrastRatio(hover, foreground) >= 4.5) { break; }
  }
  return { 'statusBar.background': background, 'statusBar.inactiveBackground': background + 'B3',
    'statusBar.foreground': foreground,
    'statusBarItem.hoverBackground': hover };
}

export function randomColor(current?: string): string {
  const previous = current ? rgbToOklch(hexToRgb(current)) : undefined;
  for (let i = 0; i < 100; i++) {
    const candidate = rgbToHex([Math.random(), Math.random(), Math.random()]);
    const next = rgbToOklch(hexToRgb(candidate));
    const distance = previous ? Math.hypot(next.l - previous.l,
      next.c * Math.cos(next.h) - previous.c * Math.cos(previous.h),
      next.c * Math.sin(next.h) - previous.c * Math.sin(previous.h)) : 1;
    if (next.l > 0.35 && distance > 0.12) { return candidate; }
  }
  return previous && previous.l > 0.7 ? '#2563EB' : '#F5B942';
}
