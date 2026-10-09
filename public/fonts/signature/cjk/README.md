# Astra CJK font subsets

Modified fonts generated from the six unchanged sources listed in [SOURCES.md](../SOURCES.md), licensed under the SIL Open Font License 1.1. The source copyright and license metadata are retained in each font. Each directory includes an exact copy of its original OFL text:

- [Ma Shan Zheng](./mashanzheng/OFL.txt)
- [Long Cang](./longcang/OFL.txt)
- [Zhi Mang Xing](./zhimangxing/OFL.txt)
- [Liu Jian Mao Cao](./liujianmaocao/OFL.txt)
- [ZCOOL XiaoWei](./zcoolxiaowei/OFL.txt)
- [ZCOOL KuaiLe](./zcoolkuaile/OFL.txt)

Modification: subset the original CJK mappings within U+4E00–U+9FFF in 256-codepoint blocks, retaining original decomposed outlines, advances, bearings, hint bytes and global geometry metrics. Internal name records 1/3/4/6/16 use `Astra CJK {font-id} {block}` (PostScript names use hyphens). Original font names are not used as the internal modified font family. Browser CSS aliases preserve existing project compatibility; they do not change the modified font metadata.

WOFF2 private data contains `ACM1` plus the subset cmap for explicit missing-glyph checks. Hashed JSON manifests pin source SHA256, sizes, per-block SHA256 and supported codepoints. The source layout audit rejects CJK layout dependencies across blocks. Other scripts, mixed text and longer runs use the unchanged complete-font transport.

Reproduce with [the generator](../../../../scripts/build-signature-font-subsets.py) and [pinned dependencies](../../../../scripts/signature-font-transport-requirements.txt). Generated filenames are immutable. [Verification and limits](../../../../docs/plans/signature-font-subsets-2026-10-09.md) distinguish geometry checks, browser pixel cases and measured download savings from real-device or commercial acceptance. Fonts are typography aids and do not reproduce a person's handwriting. The fonts may not be sold by themselves; redistribution must retain their copyright and OFL terms.
