# Bundled fonts

- Cubic 11: https://github.com/ACh-K/Cubic-11 — upstream WOFF2, SIL OFL 1.1; see Cubic-11-OFL.txt.
- Noto Sans TC: https://github.com/google/fonts/tree/main/ofl/notosanstc — variable font (100–900), losslessly encoded as WOFF2 using fontTools; SIL OFL 1.1; see NotoSansTC-OFL.txt.

Keep both copyright and license files with distributions. Both complete character sets are retained, including user-entered names. Fonts are served locally; no third-party font request is required.

UI body/forms/menu/prices: Noto Sans TC, 16px body. Game headings/buttons/signs/names: Cubic 11 (regular, no synthetic bold requested). Signs have a 16 CSS px floor; names and speech have a 14 CSS px floor regardless of map scale or DPR. Long signs ellipsize rather than squeezing glyphs; the store list and entry action retain the full store name. Product stand labels retain their spatial layout, with a 16px minimum full name/price callout when approached and the full menu available in the side panel.
