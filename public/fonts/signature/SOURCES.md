# Signature fonts

2026-10-09 web transport: six full WOFF2 files preserve the canonical glyph outlines, advances, hints and original cmap. Standard WOFF2 private data carries `ACM1` + original cmap for runtime missing-glyph checks; the browser renders the native compressed font. Original TTF files, names and OFL texts below remain the canonical project/license identity. These complete WOFF2 files are not subsetted. Generated descriptors and hashes: [font-web.ts](../../../src/lib/signature-portrait/font-web.ts); reproducible conversion: [generator](../../../scripts/build-signature-font-web.py), [pinned dependencies](../../../scripts/signature-font-transport-requirements.txt); [validation and limitations](../../../docs/plans/signature-font-web-2026-10-09.md).

2026-10-09 CJK transport: [modified OFL subsets](./cjk/README.md) cover the same source mappings within U+4E00–U+9FFF, split into 256-codepoint blocks. Pure CJK names up to 32 characters load only the needed blocks; other scripts and mixed names retain complete WOFF2 shaping. Copyright and OFL remain in each font directory. Internal modified font names use `Astra CJK {id} {block}`, while project recipes continue to identify the unchanged canonical TTF. This adds static deployment assets; it reduces selected name downloads, not deployment package size. [Pinned subset descriptors](../../../src/lib/signature-portrait/font-subsets.ts), [subset generator](../../../scripts/build-signature-font-subsets.py), [stage validation](../../../docs/plans/signature-font-subsets-2026-10-09.md).

These unmodified TrueType fonts are locally hosted, selected on demand, and used as typography aids. They do not reproduce any person's handwriting.

- Ma Shan Zheng: [pinned source](https://github.com/google/fonts/tree/406197b91ff39a93061c2c2eeaee67ddf2ae1f0d/ofl/mashanzheng), SHA256 `6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb`, 5,857,936 bytes. Full copyright and OFL1.1: [mashanzheng-OFL.txt](./mashanzheng-OFL.txt).
- Long Cang: [pinned source](https://github.com/google/fonts/tree/35e5529ffaf259a96693b048d9d97cdaa76b6837/ofl/longcang), SHA256 `e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc`, 5,162,508 bytes. Full copyright and OFL1.1: [longcang-OFL.txt](./longcang-OFL.txt).

The 2026-10-07 extension pins Google Fonts commit `5e8a3ba899557829a76cfdac30fa512bda91d7ca`:

- Zhi Mang Xing (行草), [OFL](./zhimangxing-OFL.txt), 4,063,532 bytes.
- Liu Jian Mao Cao (毛草), [OFL](./liujianmaocao-OFL.txt), 4,951,804 bytes.
- ZCOOL XiaoWei (宋韵), [OFL](./zcoolxiaowei-OFL.txt), 6,313,808 bytes.
- ZCOOL KuaiLe (圆趣), [OFL](./zcoolkuaile-OFL.txt), 1,514,968 bytes.

Exact source URLs, upstream Git blob identities and SHA256: [extension source records](../../../docs/research/2026-10-07-signature-fonts/sources.json). Acquisition: `scripts/acquire-signature-font-extension.mjs`. Full licenses also accompany portable `.astra-signature` templates.

OFL permits bundling and embedding with its conditions, including retaining the license/copyright and not selling the font alone. The original font names and files are retained. Metadata and verification: [research](../../../docs/research/2026-10-04-signature-fonts/README.md), [source hashes](../../../docs/research/2026-10-04-signature-fonts/sources.json). `scripts/acquire-signature-fonts.mjs` acquires these fixed revisions and checks the upstream Git blob identity before saving.
