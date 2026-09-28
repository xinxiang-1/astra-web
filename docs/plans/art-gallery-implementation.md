# Astra gallery implementation

The approved `design/astra-prototype-v1` images guide the graphite / warm paper / cyan visual design. Existing ASCII conversion, video encoding, and Studio effects are reused.

## Routes

- `/`: real generated character artwork, draggable original/result comparison, selected presets, creation steps.
- `/gallery`: six functional presets, category filters and title search. Choosing a preset opens `/ascii-art?preset=...`.
- `/ascii-art`: source/presets on the left, preview in the center, controls on the right. Mobile moves source and controls into tabs beneath the preview. Existing image, short-video, phrase, animated HTML and fullscreen capabilities remain available.
- `/projects`: browser-local projects in IndexedDB, including the source file, settings, thumbnail and name. Users explicitly save a project in the editor, reopen it, search/filter it or confirm its removal.
- Existing authentication, experimental tools and Studio routes remain available.

## Export and persistence

The export drawer supports PNG (1080 / 2048 / 3840 pixel long edge, optional transparent background), TXT, short-video MP4/WebM and animated HTML. PNG glyphs are painted at the chosen resolution; the image is fitted without changing aspect ratio. Preview and image/video export share palette and glyph metrics.

All current exports are free. The prototype's subscription prices, export quotas, cloud sync and commercial-rights promises are not implemented as simulated features. Projects are local to this browser and device; clearing site data removes them. Animated HTML needs network access to load its existing effect engine, and video HTML asks for a source video when opened.

The homepage portrait is generated from the user's approved prototype via built-in ImageGen. Source details and generation prompt are in `public/artwork/SOURCES.md`. Preview art is rendered by the product itself; it is not an embedded mockup screenshot.

## Verification

Start `npm run dev -- --host 127.0.0.1`, then run:

```sh
node scripts/art-ui-smoke.mjs
node scripts/art-export-smoke.mjs
npm run build
```

The first Playwright script checks desktop/mobile navigation, gallery filters/search, preset application, upload, project save/reload and PNG dimensions; it saves screenshots under ignored `test-results/art-ui`.

The second checks 4K RGBA PNG, TXT, embedded-image HTML, invalid-file recovery, short-video export, video project restoration and deletion/cancellation.

Changed TypeScript/Vue files pass ESLint. Direct `vue-tsc --noEmit -p tsconfig.views.json` still reports pre-existing errors in Prism texture/bindings/renderer and `src/lib/ascii/loop/capture.ts`; the current npm type-check script masks these with a soft success, so it is not used as evidence of a clean type check.
