# Approved MIDAN fonts, hosted locally

These are the same four families already selected in the app, distributed with their SIL OFL licenses. No typography tokens, page design, font sizes or colors were changed. `next/font/local` replaces build-time Google Fonts requests; browsers continue to receive first-party font assets through Next.

All sources are pinned to Google Fonts repository commit `86aced91de05cd4f96a06838124cca45be337b2b`. `manifest.json` records the exact upstream URLs, input/output SHA-256 checksums and transformations. No runtime font package is needed.

- IBM Plex Sans: original, unmodified upstream variable TTF. The app exposes its existing 400–700 weights; the width axis stays at its original default 100.
- IBM Plex Sans Arabic: original, unmodified upstream TTFs at 400/500/600/700. Internal font names and original binaries are preserved, respecting the reserved Plex name.
- Noto Kufi Arabic: upstream variable font converted losslessly to WOFF2, with weight range 100–900 retained.
- Bricolage Grotesque: upstream variable font converted to WOFF2. The omitted axes of the original Google request are pinned to their declared defaults (`opsz=14`, `wdth=100`); the original weight axis 200–800 is retained. This avoids introducing responsive optical sizing or width changes.

Full upstream language coverage is retained, including Latin characters in Arabic headings/body text. Conversion/axis instancing used FontTools; no glyphs were redesigned or substituted. Font source and output hashes were checked during final verification.
