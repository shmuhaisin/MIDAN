import sharp from 'sharp';

/**
 * A company's visual identity, read from its own logo. Nothing here is chosen by hand: the colours are the logo's, and
 * the light and dark themes are derived from them so that every text and button colour meets WCAG AA on the surface
 * it's drawn on. The algorithm:
 *
 *  1. The logo is decoded and reduced (at most 160 px a side). Pixels under 63% opacity are ignored, so a transparent
 *     background and soft anti-aliased edges never count.
 *  2. An opaque background is recognised from the image's border: when most border pixels share one colour (a white or
 *     coloured box behind the mark), every pixel close to that colour is ignored.
 *  3. The remaining pixels are grouped in OKLab, a perceptual colour space, by hue (chromatic colours) or by lightness
 *     (neutrals), and neighbouring groups that look alike are merged.
 *  4. The primary colour is the chromatic group that carries the most of the mark, weighted by how saturated it is, so
 *     a thin coloured stroke can't beat a large coloured field but a vivid brand colour beats a dull one of similar
 *     size. White, grey and black are used only when the logo has no colour of its own (a genuinely monochrome brand).
 *  5. Secondary and accent are the next groups whose hue or lightness clearly differ from the primary.
 *  6. Each theme keeps the brand colour where it already reads well and moves only its lightness (never its hue) when
 *     it doesn't, until text reaches 4.5:1 and controls 3:1.
 */

export const PALETTE_VERSION = 'logo-palette-v1';

export type Swatch = { hex: string; share: number; role: 'chromatic' | 'neutral' };
export type ThemeColors = {
  /** Buttons and active navigation: the brand colour, adjusted only if it can't carry readable text. */
  primary: string;
  on_primary: string;
  primary_hover: string;
  /** Links and highlighted text on the page's own background, and the label colour to put on it as a fill. */
  text: string;
  on_text: string;
  accent: string;
  on_accent: string;
  /** A quiet tint of the primary for selected rows, badges and the workspace band. */
  soft: string;
  on_soft: string;
  /** Deep panels (the workspace's dark bands, decision panels): ivory text at 7:1, in both themes. */
  deep: string;
  deep_2: string;
  deep_muted: string;
  /** A light tint for buttons and marks on a deep panel (4.5:1 on deep). */
  tint: string;
};
export type BrandPalette = {
  version: typeof PALETTE_VERSION;
  primary: string;
  secondary: string | null;
  accent: string | null;
  swatches: Swatch[];
  background: string | null;
  monochrome: boolean;
  light: ThemeColors;
  dark: ThemeColors;
};

/** The page surfaces MIDAN draws a workspace on (apps/web globals.css): ivory in light, deep green-black in dark. */
export const SURFACES = { light: '#f7f4ee', dark: '#0a1f19' } as const;
/**
 * Every surface company-coloured text and controls can sit on inside a workspace, per theme (globals.css: background,
 * surface, surface-2, surface-3 and the success surface chips use). Text must reach 4.5:1 on all of them, not just the
 * page: a link on a card or a count on a chip is read there.
 */
export const SURFACE_RANGE = {
  light: ['#f7f4ee', '#fdfcf9', '#efece4', '#e4e0d5', '#e3f1ea'],
  dark: ['#0a1f19', '#0c271e', '#113327', '#184031', '#123a2b'],
} as const;
const worst = (c: Rgb, theme: 'light' | 'dark') => Math.min(...SURFACE_RANGE[theme].map((s) => contrast(c, s)));

type Rgb = [number, number, number];
type Lab = [number, number, number];

// ---------- colour maths: sRGB, OKLab, contrast ----------
const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]: Rgb): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLab to sRGB, bringing an out-of-gamut colour back by lowering its chroma (keeping hue and lightness). */
export function oklabToRgb(lab: Lab): Rgb {
  let [L, a, b] = lab;
  for (let i = 0; i < 24; i++) {
    const lin = oklabToLinear([L, a, b]);
    if (lin.every((c) => c >= -0.0005 && c <= 1.0005)) return lin.map((c) => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))))) as Rgb;
    a *= 0.9; b *= 0.9;
  }
  return oklabToLinear([L, 0, 0]).map((c) => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))))) as Rgb;
}

export const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export const parseHex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const luminance = (c: Rgb) => { const [r, g, b] = c.map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a: string | Rgb, b: string | Rgb) {
  const [x, y] = [luminance(typeof a === 'string' ? parseHex(a) : a), luminance(typeof b === 'string' ? parseHex(b) : b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const chroma = ([, a, b]: Lab) => Math.hypot(a, b);
const hue = ([, a, b]: Lab) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const hueGap = (x: number, y: number) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
const distance = (x: Lab, y: Lab) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

/** Moves a colour's lightness (hue kept, chroma eased toward the ends) until `ok` holds, in the direction given. */
function shiftLightness(start: Rgb, direction: 1 | -1, ok: (c: Rgb) => boolean): Rgb {
  const [L0, a0, b0] = rgbToOklab(start);
  for (let step = 1; step <= 60; step++) {
    const L = Math.min(0.99, Math.max(0.03, L0 + direction * step * 0.012));
    const ease = 1 - Math.min(0.6, Math.abs(L - L0) * 0.9);
    const c = oklabToRgb([L, a0 * ease, b0 * ease]);
    if (ok(c)) return c;
  }
  return direction > 0 ? [250, 250, 250] : [17, 17, 17];
}

const WHITE = '#ffffff';
const INK = '#141414';
const bestOn = (bg: Rgb) => (contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK);

/** A fill (button, badge) whose label reads at 4.5:1 and whose edge stands out from the page at 3:1. */
function fill(color: Rgb, theme: 'light' | 'dark'): { fill: Rgb; on: string } {
  const good = (c: Rgb) => contrast(c, bestOn(c)) >= 4.5 && worst(c, theme) >= 3;
  if (good(color)) return { fill: color, on: bestOn(color) };
  // In light, deepen the colour; in dark, brighten it — the way a designer would adapt the same brand to each.
  const moved = shiftLightness(color, theme === 'light' ? -1 : 1, good);
  return { fill: moved, on: bestOn(moved) };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const [x, y] = [rgbToOklab(a), rgbToOklab(b)];
  return oklabToRgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** The light and dark themes for chosen brand colours. Pure, so a representative's choice is themed the same way. */
export function themesFor(primaryHex: string, accentHex: string | null): { light: ThemeColors; dark: ThemeColors } {
  const primary = parseHex(primaryHex);
  const accent = accentHex ? parseHex(accentHex) : primary;
  const build = (theme: 'light' | 'dark'): ThemeColors => {
    const surface = SURFACES[theme];
    const surfaceRgb = parseHex(surface);
    const p = fill(primary, theme);
    const a = fill(accent, theme);
    const text = shiftLightness(primary, theme === 'light' ? -1 : 1, (c) => worst(c, theme) >= 4.5);
    const keepText = worst(primary, theme) >= 4.5 ? primary : text;
    // Hover keeps the same label colour, so it moves away from it: darker under white text, lighter under dark text.
    const hover = shiftLightness(p.fill, p.on === WHITE ? -1 : 1, (c) => distance(rgbToOklab(c), rgbToOklab(p.fill)) >= 0.04 && contrast(c, p.on) >= 4.5);
    const soft = mix(surfaceRgb, primary, theme === 'light' ? 0.12 : 0.22);
    const onSoft = shiftLightness(primary, theme === 'light' ? -1 : 1, (c) => contrast(c, soft) >= 4.5);
    const ivory = parseHex(SURFACES.light);
    const deep = shiftLightness(primary, -1, (c) => contrast(c, ivory) >= 7);
    const deep2 = shiftLightness(deep, -1, (c) => distance(rgbToOklab(c), rgbToOklab(deep)) >= 0.04);
    const deepMuted = shiftLightness(mix(ivory, deep, 0.2), 1, (c) => contrast(c, deep) >= 4.5 && contrast(c, deep2) >= 4.5);
    const tint = shiftLightness(mix(ivory, primary, 0.2), 1, (c) => contrast(c, deep) >= 4.5 && contrast(c, deep2) >= 4.5);
    return {
      primary: hex(p.fill), on_primary: p.on, primary_hover: hex(hover),
      text: hex(keepText), on_text: bestOn(keepText),
      deep: hex(deep), deep_2: hex(deep2), deep_muted: hex(deepMuted), tint: hex(tint),
      accent: hex(a.fill), on_accent: a.on,
      soft: hex(soft), on_soft: hex(contrast(primary, soft) >= 4.5 ? primary : onSoft),
    };
  };
  return { light: build('light'), dark: build('dark') };
}

// ---------- reading the logo ----------
type Group = { lab: Lab; weight: number; count: number };

/** Pixels of the logo that belong to the mark: opaque enough, and not the background box behind it. */
export function markPixels(data: Uint8Array | Buffer, width: number, height: number, channels: number): { pixels: Rgb[]; background: Rgb | null } {
  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2], channels === 4 ? data[i + 3] : 255];
  };
  // The border: one pixel all round.
  const border: Rgb[] = [];
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) { const p = at(x, y); if (p[3] >= 250) border.push([p[0], p[1], p[2]]); }
  for (let y = 1; y < height - 1; y++) for (const x of [0, width - 1]) { const p = at(x, y); if (p[3] >= 250) border.push([p[0], p[1], p[2]]); }
  const perimeter = 2 * (width + height) - 4;
  let background: Rgb | null = null;
  if (border.length >= perimeter * 0.6) {
    // The most common border colour (16 levels per channel), and how much of the border it covers.
    const counts = new Map<number, Rgb[]>();
    for (const c of border) { const k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4); counts.set(k, [...(counts.get(k) ?? []), c]); }
    const top = [...counts.values()].sort((a, b) => b.length - a.length)[0];
    if (top.length >= border.length * 0.6) background = [0, 1, 2].map((i) => Math.round(top.reduce((s, c) => s + c[i], 0) / top.length)) as Rgb;
  }
  const bgLab = background ? rgbToOklab(background) : null;
  const pixels: Rgb[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y);
      if (p[3] < 160) continue;
      const c: Rgb = [p[0], p[1], p[2]];
      if (bgLab && distance(rgbToOklab(c), bgLab) < 0.09) continue;
      pixels.push(c);
    }
  }
  return { pixels, background };
}

/** Groups pixels into the logo's colours: by hue for colours, by lightness for neutrals, then merges look-alikes. */
export function groupColours(pixels: Rgb[]): Group[] {
  const bins = new Map<string, { sum: Lab; count: number }>();
  for (const c of pixels) {
    const lab = rgbToOklab(c);
    const key = chroma(lab) >= 0.045 ? `h${Math.floor(hue(lab) / 12)}l${Math.floor(lab[0] * 4)}` : `n${Math.floor(lab[0] * 6)}`;
    const bin = bins.get(key) ?? { sum: [0, 0, 0] as Lab, count: 0 };
    bin.sum = [bin.sum[0] + lab[0], bin.sum[1] + lab[1], bin.sum[2] + lab[2]];
    bin.count++;
    bins.set(key, bin);
  }
  let groups: Group[] = [...bins.values()].map((b) => ({ lab: b.sum.map((v) => v / b.count) as Lab, count: b.count, weight: b.count }));
  groups.sort((a, b) => b.count - a.count);
  // Merge groups that a person would call the same colour (gradients and shading of one brand colour).
  const merged: Group[] = [];
  for (const g of groups) {
    const same = merged.find((m) => distance(m.lab, g.lab) < 0.1 && (chroma(m.lab) < 0.045) === (chroma(g.lab) < 0.045));
    if (same) {
      const n = same.count + g.count;
      same.lab = [0, 1, 2].map((i) => (same.lab[i] * same.count + g.lab[i] * g.count) / n) as Lab;
      same.count = n;
      same.weight = n;
    } else merged.push({ ...g });
  }
  return merged;
}

/** The logo's colours as a palette with light and dark themes. Throws on an unreadable image or an empty mark. */
export async function extractPalette(image: Buffer): Promise<BrandPalette> {
  const { data, info } = await sharp(image, { failOn: 'error' })
    .rotate()
    .resize(160, 160, { fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { pixels, background } = markPixels(data, info.width, info.height, info.channels);
  if (pixels.length < 20) throw new Error('The logo has no visible mark to read colours from');
  const groups = groupColours(pixels);
  const total = pixels.length;
  const share = (g: Group) => g.count / total;
  const isColour = (g: Group) => chroma(g.lab) >= 0.045;
  const chromatic = groups.filter((g) => isColour(g) && share(g) >= 0.015);
  // Score: area, with saturation as a tie-breaker that matters (a vivid 20% beats a dull 25%).
  const score = (g: Group) => share(g) * (0.55 + Math.min(chroma(g.lab), 0.25) * 3);
  chromatic.sort((a, b) => score(b) - score(a));

  let primary: Group;
  let monochrome = false;
  if (chromatic.length && chromatic.reduce((s, g) => s + share(g), 0) >= 0.04) {
    primary = chromatic[0];
  } else {
    // No colour of its own: the brand is its dominant neutral (usually black or a dark grey). Very light neutrals can't
    // carry a brand on a light page, so the darkest substantial neutral is preferred.
    monochrome = true;
    const neutrals = groups.filter((g) => share(g) >= 0.05).sort((a, b) => a.lab[0] - b.lab[0]);
    primary = neutrals[0] ?? groups[0];
  }
  const distinct = (g: Group, from: Group[]) => from.every((f) => (isColour(g) && isColour(f) ? hueGap(hue(g.lab), hue(f.lab)) >= 25 : false) || Math.abs(g.lab[0] - f.lab[0]) >= 0.2);
  // Secondary and accent must be real parts of the mark (3%+), not the anti-aliased fringe of the primary.
  const rest = chromatic.filter((g) => g !== primary && share(g) >= 0.03);
  const secondary = rest.find((g) => distinct(g, [primary])) ?? null;
  const accent = [...rest].sort((a, b) => chroma(b.lab) - chroma(a.lab)).find((g) => g !== secondary && distinct(g, [primary, ...(secondary ? [secondary] : [])])) ?? secondary;

  const toHex = (g: Group) => hex(oklabToRgb(g.lab));
  const swatches: Swatch[] = groups
    .filter((g) => share(g) >= 0.01)
    .slice(0, 8)
    .map((g) => ({ hex: toHex(g), share: Math.round(share(g) * 1000) / 1000, role: isColour(g) ? 'chromatic' : 'neutral' }));
  const primaryHex = toHex(primary);
  const accentHex = accent ? toHex(accent) : null;
  return {
    version: PALETTE_VERSION,
    primary: primaryHex,
    secondary: secondary ? toHex(secondary) : null,
    accent: accentHex,
    swatches,
    background: background ? hex(background) : null,
    monochrome,
    ...themesFor(primaryHex, accentHex),
  };
}

/**
 * Branding as it's read: the themes of the approved palette (and of a pending suggestion) recomputed from their chosen
 * colours by the current rules, so an improvement to the contrast rules reaches every company without a data migration.
 * The chosen colours themselves never change here.
 */
export function withCurrentThemes<T extends { palette?: unknown; applied_palette?: unknown } | null>(branding: T): T {
  if (!branding) return branding;
  const fresh = (p: unknown) => {
    const palette = p as BrandPalette | null;
    if (!palette || palette.version !== PALETTE_VERSION || !/^#[0-9a-f]{6}$/i.test(palette.primary ?? '')) return p;
    return { ...palette, ...themesFor(palette.primary, palette.accent && /^#[0-9a-f]{6}$/i.test(palette.accent) ? palette.accent : null) };
  };
  return { ...branding, palette: fresh(branding.palette), applied_palette: fresh(branding.applied_palette) };
}
