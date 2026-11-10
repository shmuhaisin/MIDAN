import sharp from 'sharp';
import { contrast, extractPalette, parseHex, rgbToOklab, SURFACES, themesFor } from './brand-palette';

/** A logo drawn from SVG shapes, rendered as PNG by the same library the API decodes with. */
async function logo(svg: string, background?: string) {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${background ? `<rect width="400" height="200" fill="${background}"/>` : ''}${svg}</svg>`;
  return sharp(Buffer.from(body)).png().toBuffer();
}

const hue = (h: string) => { const [, a, b] = rgbToOklab(parseHex(h)); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };
const near = (h: string, target: string, degrees = 15) => {
  const d = Math.abs(hue(h) - hue(target)) % 360;
  return (d > 180 ? 360 - d : d) <= degrees;
};

describe('extractPalette', () => {
  it('reads a purple wordmark on a white box as purple, not white, with a coral accent', async () => {
    const png = await logo('<rect x="30" y="50" width="250" height="100" fill="#4f008c"/><circle cx="330" cy="100" r="40" fill="#ff375e"/>', '#ffffff');
    const p = await extractPalette(png);
    expect(p.background).toBe('#ffffff');
    expect(p.monochrome).toBe(false);
    expect(near(p.primary, '#4f008c')).toBe(true);
    expect(p.accent && near(p.accent, '#ff375e')).toBe(true);
    expect(p.swatches.some((s) => s.hex === '#ffffff')).toBe(false);
  });

  it('ignores transparent pixels and keeps a small vivid colour over a large dull one only when it earns it', async () => {
    const png = await logo('<rect x="0" y="0" width="240" height="200" fill="#1d4ed8"/><rect x="250" y="40" width="120" height="120" fill="#f59e0b"/>');
    const p = await extractPalette(png);
    expect(p.background).toBeNull();
    expect(near(p.primary, '#1d4ed8')).toBe(true);
    expect(p.accent && near(p.accent, '#f59e0b')).toBe(true);
  });

  it('treats a coloured box behind the mark as background', async () => {
    const png = await logo('<circle cx="200" cy="100" r="70" fill="#e11d48"/>', '#0f172a');
    const p = await extractPalette(png);
    expect(p.background).not.toBeNull();
    expect(near(p.primary, '#e11d48')).toBe(true);
  });

  it('keeps black as the brand when the logo has no colour of its own', async () => {
    const png = await logo('<rect x="40" y="60" width="320" height="80" fill="#111111"/>', '#ffffff');
    const p = await extractPalette(png);
    expect(p.monochrome).toBe(true);
    expect(rgbToOklab(parseHex(p.primary))[0]).toBeLessThan(0.3);
  });

  it('refuses an image with nothing on it', async () => {
    await expect(extractPalette(await logo('', '#ffffff'))).rejects.toThrow(/no visible mark/);
  });

  it('refuses something that is not an image', async () => {
    await expect(extractPalette(Buffer.from('not an image'))).rejects.toThrow();
  });
});

describe('themesFor', () => {
  for (const [name, primary, accent] of [
    ['deep purple', '#4f008c', '#ff375e'],
    ['light yellow', '#ffe14d', '#00a3e0'],
    ['mid green', '#22c55e', null],
    ['near black', '#111111', null],
    ['pale pink', '#fbcfe8', '#be185d'],
  ] as const) {
    it(`gives readable buttons, links and tints in both themes for ${name}`, () => {
      const themes = themesFor(primary, accent);
      for (const theme of ['light', 'dark'] as const) {
        const t = themes[theme];
        const surface = SURFACES[theme];
        expect(contrast(t.primary, t.on_primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.primary, surface)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.primary_hover, t.on_primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.text, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.accent, t.on_accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.soft, t.on_soft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.text, t.on_text)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.deep, SURFACES.light)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.deep_2, SURFACES.light)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.deep_muted, t.deep)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.tint, t.deep)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.tint, t.deep_2)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('keeps the brand colour itself when it already reads well', () => {
    expect(themesFor('#4f008c', null).light.primary).toBe('#4f008c');
  });

  it('changes lightness, not hue, when it has to adjust', () => {
    const dark = themesFor('#4f008c', null).dark;
    expect(near(dark.primary, '#4f008c', 20)).toBe(true);
    expect(rgbToOklab(parseHex(dark.text))[0]).toBeGreaterThan(rgbToOklab(parseHex('#4f008c'))[0]);
  });
});
