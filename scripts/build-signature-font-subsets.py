"""Pinned OFL CJK shards. Full source fonts remain canonical and handle other scripts."""
import argparse
import base64
import hashlib
import io
import json
import shutil
import runpy
from pathlib import Path
from fontTools import subset, version as fonttools_version
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
import brotli

ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = runpy.run_path(str(Path(__file__).with_name('build-signature-font-web.py')))
PINS = TRANSPORT['PINS']
START, END, BLOCK = 0x4e00, 0x9fff, 256
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def assert_independent_cjk(font, glyphs):
    """Fail closed if future sources introduce CJK shaping across FontFace boundaries."""
    assert 'kern' not in font, 'Legacy kerning must be reviewed before sharding'
    rows = []
    for tag in ('GSUB', 'GPOS'):
        if tag not in font or not font[tag].table.LookupList:
            continue
        for lookup in font[tag].table.LookupList.Lookup:
            assert lookup.LookupType == (1 if tag == 'GSUB' else 2), 'Unreviewed layout lookup'
            for table in lookup.SubTable:
                inputs = set(table.mapping) if tag == 'GSUB' else set(table.Coverage.glyphs)
                assert not inputs & glyphs, 'CJK layout depends on a multi-character run'
                rows.append({'table': tag, 'lookup': lookup.LookupType, 'inputGlyphs': len(inputs), 'cjkInputs': 0})
    return rows


def shape(font, name):
    glyphs = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(pen)
    glyph = font['glyf'][name]
    hints = glyph.program.getBytecode().hex() if hasattr(glyph, 'program') else ''
    return [font['hmtx'].metrics[name], pen.value, hints]


def build_one(identifier, filename, source_sha, output):
    original = (ROOT / 'public/fonts/signature' / filename).read_bytes()
    assert sha(original) == source_sha
    source = TTFont(io.BytesIO(original), recalcBBoxes=False, recalcTimestamp=False)
    cmap = {cp: name for cp, name in source.getBestCmap().items() if START <= cp <= END}
    layout = assert_independent_cjk(source, set(cmap.values()))
    bitset = bytearray((END - START + 1) // 8)
    for cp in cmap:
        bitset[(cp - START) // 8] |= 1 << ((cp - START) % 8)
    source_shapes = {name: shape(source, name) for name in set(cmap.values())}
    destination = output / identifier
    destination.mkdir()
    shards = []
    verified = 0
    for first in range(START, END + 1, BLOCK):
        points = sorted(cp for cp in cmap if first <= cp < first + BLOCK)
        if not points:
            continue
        font = TTFont(io.BytesIO(original), recalcBBoxes=False, recalcTimestamp=False)
        options = subset.Options()
        options.hinting = True
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.name_legacy = True
        options.glyph_names = True
        options.notdef_outline = True
        options.recalc_bounds = False
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=points)
        subsetter.subset(font)
        # Modified OFL fonts use distinct internal names, with copyright/license retained.
        internal_name = f'Astra CJK {identifier} {first:04x}'
        for record in font['name'].names:
            if record.nameID in (1, 3, 4, 6, 16):
                record.string = (internal_name.replace(' ', '-') if record.nameID == 6 else internal_name).encode(record.getEncoding())
        private_cmap = font.getTableData('cmap')
        font.flavor = 'woff2'
        stream = io.BytesIO()
        font.save(stream)
        encoded = TRANSPORT['attach_cmap'](stream.getvalue(), private_cmap)
        restored = TTFont(io.BytesIO(encoded), recalcBBoxes=False, recalcTimestamp=False)
        restored_cmap = restored.getBestCmap()
        assert set(restored_cmap) == set(points), 'Unexpected shard coverage'
        for cp in points:
            assert source_shapes[cmap[cp]] == shape(restored, restored_cmap[cp]), f'Outline/metrics/hint changed: {identifier} U+{cp:04X}'
            verified += 1
        for table, fields in {
            'head': ['unitsPerEm', 'xMin', 'yMin', 'xMax', 'yMax', 'macStyle'],
            'hhea': ['ascent', 'descent', 'lineGap'],
            'OS/2': ['sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent', 'fsSelection'],
        }.items():
            assert all(getattr(source[table], field) == getattr(restored[table], field) for field in fields), 'Global font metrics changed'
        name = f'{first:04x}-{sha(encoded)[:12]}.woff2'
        (destination / name).write_bytes(encoded)
        shards.append({'first': first, 'last': first + BLOCK - 1, 'file': name, 'bytes': len(encoded), 'sha256': sha(encoded)})
    license_file = ROOT / 'public/fonts/signature' / f'{identifier}-OFL.txt'
    shutil.copyfile(license_file, destination / 'OFL.txt')
    manifest = {'version': 1, 'sourceSha256': source_sha, 'start': START, 'end': END, 'block': BLOCK,
                'coverage': base64.b64encode(bitset).decode(), 'shards': shards}
    raw_manifest = (json.dumps(manifest, separators=(',', ':'), ensure_ascii=True) + '\n').encode()
    manifest_file = f'manifest-{sha(raw_manifest)[:12]}.json'
    (destination / manifest_file).write_bytes(raw_manifest)
    print(json.dumps({'font': identifier, 'shards': len(shards), 'unicodeGlyphsVerified': verified,
                      'shardBytes': sum(s['bytes'] for s in shards), 'manifestBytes': len(raw_manifest)}), flush=True)
    return {'file': f'{identifier}/{manifest_file}', 'sha256': sha(raw_manifest), 'bytes': len(raw_manifest), 'sourceSha256': source_sha}, {
        'id': identifier, 'sourceSha256': source_sha, 'unicodeGlyphsVerified': verified, 'shards': len(shards),
        'shardBytes': sum(s['bytes'] for s in shards), 'manifestBytes': len(raw_manifest), 'layoutAudit': layout,
        'licenseSha256': sha(license_file.read_bytes()), 'sourceTtfRetained': True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--write-assets', action='store_true')
    args = parser.parse_args()
    assert fonttools_version == '4.60.2' and brotli.__version__ == '1.1.0', 'Use pinned transport requirements'
    assert not args.output.exists(), 'Preserve prior evidence'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    candidates = args.output.parent / (args.output.stem + '-assets')
    candidates.mkdir(exist_ok=False)
    descriptors, records = {}, []
    for identifier, filename, source_sha in PINS:
        descriptors[identifier], row = build_one(identifier, filename, source_sha, candidates)
        records.append(row)
    if args.write_assets:
        target = ROOT / 'public/fonts/signature/cjk'
        for path in candidates.rglob('*'):
            if not path.is_file():
                continue
            destination = target / path.relative_to(candidates)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                assert destination.read_bytes() == path.read_bytes(), 'Existing immutable shard differs'
            else:
                shutil.copyfile(path, destination)
        text = '// Generated pinned CJK manifests; other scripts retain the full canonical transport.\n'
        text += 'export const SIGNATURE_FONT_SUBSETS = ' + json.dumps(descriptors, indent=2) + ' as const\n'
        (ROOT / 'src/lib/signature-portrait/font-subsets.ts').write_text(text, encoding='utf-8')
    report = {'passed': True, 'scope': 'Pinned CJK-only shard geometry/hints/metrics/coverage and layout audit; browser pixels pending',
              'tools': {'fonttools': fonttools_version, 'brotli': brotli.__version__}, 'assetsWritten': args.write_assets,
              'fonts': records, 'scriptSha256': sha(Path(__file__).read_bytes())}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
