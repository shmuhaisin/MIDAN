import { readableOnWhite } from './format';

// A company's identity, applied only inside its own workspace and on its own job postings and assessments.
//
// The API reads the colours from the uploaded logo and derives light and dark themes that already meet WCAG AA
// (apps/api/src/organizations/brand-palette.ts). Once an owner or admin approves them, they're written here as CSS
// variables on a wrapper with the `org-themed` class; globals.css maps them onto MIDAN's own design tokens (buttons,
// links, active navigation, focus rings, accents, deep panels) for the light and the dark theme. Nothing is set on the
// document, so MIDAN's own header, footer and pages, and every other company's workspace, keep their identity.

export type ThemeColors = {
  primary: string; on_primary: string; primary_hover: string; text: string; on_text?: string;
  accent: string; on_accent: string; soft: string; on_soft: string;
  deep?: string; deep_2?: string; deep_muted?: string; tint?: string;
};
export type BrandPalette = {
  version: string; primary: string; secondary: string | null; accent: string | null;
  swatches: { hex: string; share: number; role: 'chromatic' | 'neutral' }[];
  background: string | null; monochrome: boolean; light: ThemeColors; dark: ThemeColors;
};
export type OrgBranding = {
  logo_path?: string | null;
  primary_color?: string | null; accent_color?: string | null; secondary_color?: string | null;
  /** The latest identity read from the logo (a suggestion until approved), and the one applied to the workspace. */
  palette?: BrandPalette | null; palette_status?: string | null; palette_logo_path?: string | null;
  applied_palette?: BrandPalette | null;
};

const HEX = /^#[0-9a-f]{6}$/i;
const KEYS = ['primary', 'on_primary', 'primary_hover', 'text', 'on_text', 'accent', 'on_accent', 'soft', 'on_soft', 'deep', 'deep_2', 'deep_muted', 'tint'] as const;

/**
 * The palette applied to the workspace, or null. A suggestion read from a new logo isn't applied until a person approves
 * it, and until then the previously approved identity stays.
 */
export function approvedPalette(branding: OrgBranding | null | undefined): BrandPalette | null {
  const p = branding?.applied_palette;
  if (!p || p.version !== 'logo-palette-v1') return null;
  return HEX.test(p.light?.primary ?? '') && HEX.test(p.dark?.primary ?? '') ? p : null;
}

/** The CSS variables for one palette (approved or a preview), named --org-l-* and --org-d-*. Only valid colours pass. */
export function paletteVariables(palette: BrandPalette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [prefix, theme] of [['l', palette.light], ['d', palette.dark]] as const) {
    for (const key of KEYS) {
      const value = theme[key];
      if (value && HEX.test(value)) vars[`--org-${prefix}-${key.replace(/_/g, '-')}`] = value;
    }
  }
  return vars;
}

/**
 * The wrapper props for a company's own surfaces. With an approved palette, the full theme; without one, the older
 * single-colour accent (the band, charts and the active navigation mark) that workspaces already had.
 */
export function orgTheme(branding: OrgBranding | null | undefined): { className: string; style: React.CSSProperties } {
  const palette = approvedPalette(branding);
  if (palette) return { className: 'org-themed', style: paletteVariables(palette) as React.CSSProperties };
  const primary = branding?.primary_color && HEX.test(branding.primary_color) ? branding.primary_color : null;
  const accent = branding?.accent_color && HEX.test(branding.accent_color) ? branding.accent_color : null;
  return {
    className: '',
    style: {
      ...(primary && { '--org-primary': primary, '--org-on-primary': readableOnWhite(primary) ? '#ffffff' : '#0f5b46' }),
      ...(accent && { '--org-accent': accent }),
    } as React.CSSProperties,
  };
}

/** The public address of a file in the organization-assets bucket. */
export function orgAssetUrl(path: string | null | undefined) {
  return path ? `${process.env.SUPABASE_URL}/storage/v1/object/public/organization-assets/${path}` : null;
}
