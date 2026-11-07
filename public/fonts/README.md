# Bundled fonts

- Cubic 11: https://github.com/ACh-K/Cubic-11 — upstream WOFF2, SIL OFL 1.1; see Cubic-11-OFL.txt.
- Noto Sans TC: https://github.com/google/fonts/tree/main/ofl/notosanstc — variable font (100–900), losslessly encoded as WOFF2 using fontTools; SIL OFL 1.1; see NotoSansTC-OFL.txt.

Keep both copyright and license files with distributions. Both complete character sets are retained, including user-entered names. Fonts are served locally; no third-party font request is required.

UI body/forms/menu/prices: Noto Sans TC, 16px body/input floor; menu text scales with its panel using container units. Game headings/buttons/signs/names: Cubic 11. Canvas text layout uses CSS pixels, converting to device pixels only when measuring/drawing. Map signs and information scale between 12–18/20px; names, speech and road signs between 11–18px, based on actual canvas width and height. ResizeObserver updates the canvas on rotation and menu collapse.

Map text shares a collision layout: conversation and player names take priority over shop signs, then road and vacant-lot labels. Off-camera anchors are omitted rather than pulled onto screen edges. Vacant-lot text is omitted on narrow canvases. Long labels ellipsize rather than squeezing glyphs; complete names/prices remain available in store navigation, entry actions and the ordering menu. Spatial labels on product stands retain their layout; approaching a product shows a responsive information callout.
