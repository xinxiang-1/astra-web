"""Lossless full-font web transport. No download, subsetting or outline modification."""
import argparse, gzip, hashlib, io, json, struct, sys
from pathlib import Path
from fontTools import version as fonttools_version
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData
from fontTools.pens.recordingPen import RecordingPen
import brotli

ROOT = Path(__file__).resolve().parents[1]
PINS = [
    ('mashanzheng', 'MaShanZheng-Regular.ttf', '6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb'),
    ('longcang', 'LongCang-Regular.ttf', 'e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc'),
    ('zhimangxing', 'ZhiMangXing-Regular.ttf', '644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969'),
    ('liujianmaocao', 'LiuJianMaoCao-Regular.ttf', 'cab396b91a5b7c0b4005a35891180d06e6751f5ac261fe680aec65c1ae209033'),
    ('zcoolxiaowei', 'ZCOOLXiaoWei-Regular.ttf', 'a42b620140f493db42f741351dfbf343c0936d58588ee8004b8b2a218d997ff1'),
    ('zcoolkuaile', 'ZCOOLKuaiLe-Regular.ttf', '812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d'),
]
sha = lambda raw: hashlib.sha256(raw).hexdigest()

def encode(original, flavor, private=None):
    font = TTFont(io.BytesIO(original), recalcBBoxes=False, recalcTimestamp=False)
    font.flavor = flavor
    if private is not None:
        font.flavorData = WOFF2FlavorData()
        font.flavorData.privData = b'ACM1' + private
    output = io.BytesIO()
    font.save(output)
    return output.getvalue()

def attach_cmap(plain, cmap):
    assert struct.unpack_from('>II', plain, 40) == (0, 0), 'Existing private data must not be replaced'
    private = b'ACM1' + cmap
    offset = len(plain) + (-len(plain) % 4)
    encoded = bytearray(plain + b'\x00' * (offset - len(plain)) + private)
    struct.pack_into('>I', encoded, 8, len(encoded))
    struct.pack_into('>II', encoded, 40, offset, len(private))
    return bytes(encoded)

def geometry(font):
    glyphs = font.getGlyphSet()
    digest = hashlib.sha256()
    count = 0
    for name in font.getGlyphOrder():
        pen = RecordingPen()
        glyphs[name].draw(pen)
        glyph = font['glyf'][name]
        hints = glyph.program.getBytecode().hex() if hasattr(glyph, 'program') else ''
        value = [name, glyphs[name].width, pen.value, hints]
        digest.update(json.dumps(value, separators=(',', ':'), ensure_ascii=True).encode())
        count += 1
    return count, digest.hexdigest()

def inspect(original, encoded):
    source = TTFont(io.BytesIO(original), recalcBBoxes=False, recalcTimestamp=False)
    restored = TTFont(io.BytesIO(encoded), recalcBBoxes=False, recalcTimestamp=False)
    assert source.getGlyphOrder() == restored.getGlyphOrder(), 'Glyph order changed'
    source_geometry, restored_geometry = geometry(source), geometry(restored)
    assert source_geometry == restored_geometry, 'Outline/advance/hint changed'
    assert source['cmap'].getBestCmap() == restored['cmap'].getBestCmap(), 'Unicode coverage changed'
    assert source['hmtx'].metrics == restored['hmtx'].metrics, 'Metrics changed'
    assert source.reader['cmap'] == restored.reader['cmap'], 'Actual cmap bytes changed'
    removed = set(source.keys()) - set(restored.keys())
    assert not set(restored.keys()) - set(source.keys()), 'Unexpected font table added'
    assert removed <= {'DSIG'}, 'Font table set changed'
    if 'DSIG' in removed:
        assert source.getTableData('DSIG') == b'\x00\x00\x00\x01\x00\x00\x00\x00', 'Nonempty source signature removed'
    table_hashes = {}
    for tag in source.reader.tables:
        if tag in ['glyf', 'loca', 'head'] or tag in removed:
            continue  # WOFF2 may re-encode flags/locations and checksum adjustment; geometry checked above.
        raw = source.reader[tag]
        assert raw == restored.reader[tag], 'Font table changed: ' + tag
        table_hashes[tag] = sha(raw)
    source_head = source['head'].__dict__.copy()
    restored_head = restored['head'].__dict__.copy()
    for key in ['checkSumAdjustment', 'indexToLocFormat', 'flags']:
        source_head.pop(key, None); restored_head.pop(key, None)
    assert source_head == restored_head, 'Head metrics changed'
    assert (source['head'].flags ^ restored['head'].flags) & ~(1 << 11) == 0, 'Unexpected head flag change'
    offset, length = struct.unpack_from('>II', encoded, 40)
    assert offset >= 48 and offset % 4 == 0 and offset + length == len(encoded)
    assert struct.unpack_from('>I', encoded, 8)[0] == len(encoded)
    assert encoded[offset:offset + length] == b'ACM1' + source.reader['cmap'], 'Private actual cmap not bound to source'
    assert restored.flavorData.privData == encoded[offset:offset + length], 'Standard private data parser mismatch'
    return {'glyphsVerified': source_geometry[0], 'geometrySha256': source_geometry[1],
            'unicodeMappings': len(source['cmap'].getBestCmap()), 'cmapSha256': sha(source.reader['cmap']),
            'untransformedTableSha256': table_hashes, 'privateCmapBytes': length,
            'sourceFlavor': source.sfntVersion.encode('latin1').hex(), 'removedEmptySignatureTables': sorted(removed)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--write-assets', action='store_true')
    args = parser.parse_args()
    assert not args.output.exists(), 'Preserve earlier report'
    candidates = args.output.parent / (args.output.stem + '-assets')
    candidates.mkdir(parents=True, exist_ok=False)
    records, descriptors = [], {}
    source_descriptor = (ROOT / 'src/lib/signature-portrait/fonts.ts').read_text('utf-8') + (ROOT / 'src/lib/signature-portrait/font-extension.ts').read_text('utf-8')
    for identifier, name, expected in PINS:
        source_path = ROOT / 'public/fonts/signature' / name
        original = source_path.read_bytes()
        assert sha(original) == expected and expected in source_descriptor, 'Pinned source changed'
        font = TTFont(io.BytesIO(original), recalcBBoxes=False, recalcTimestamp=False)
        cmap = font.getTableData('cmap')
        plain_woff2 = encode(original, 'woff2')
        encoded = attach_cmap(plain_woff2, cmap)
        woff = encode(original, 'woff')
        checks = inspect(original, encoded)
        filename = source_path.stem + '.woff2'
        (candidates / filename).write_bytes(encoded)
        descriptor = {'file': filename, 'sha256': sha(encoded), 'sourceSha256': expected,
                      'bytes': len(encoded), 'cmapBytes': len(cmap)}
        descriptors[identifier] = descriptor
        row = {'id': identifier, 'originalFile': name, 'originalBytes': len(original), 'originalSha256': expected,
               'gzipTtfBytes': len(gzip.compress(original, compresslevel=9, mtime=0)), 'woffBytes': len(woff),
               'plainWoff2Bytes': len(plain_woff2), 'webBytes': len(encoded), 'webSha256': sha(encoded),
               'reductionVsUncompressedTtf': 1 - len(encoded) / len(original), **checks}
        records.append(row)
        print(json.dumps({k: row[k] for k in ['id', 'originalBytes', 'gzipTtfBytes', 'woffBytes', 'plainWoff2Bytes', 'webBytes', 'glyphsVerified', 'reductionVsUncompressedTtf']}), flush=True)
    if args.write_assets:
        for descriptor in descriptors.values():
            target = ROOT / 'public/fonts/signature' / descriptor['file']
            raw = (candidates / descriptor['file']).read_bytes()
            if target.exists():
                assert target.read_bytes() == raw, 'Do not silently replace a different font transport'
            else:
                target.write_bytes(raw)
        text = '// Full lossless WOFF2 fonts with original cmap in standard private data. Generated by build-signature-font-web.py.\n'
        text += 'export const SIGNATURE_WEB_FONTS = ' + json.dumps(descriptors, ensure_ascii=False, indent=2) + ' as const\n'
        (ROOT / 'src/lib/signature-portrait/font-web.ts').write_text(text, encoding='utf-8')
    total_original, total_web = sum(r['originalBytes'] for r in records), sum(r['webBytes'] for r in records)
    report = {'passed': True, 'scope': 'All glyph outlines/advances/hints, actual cmap and nontransformed tables; not browser pixel/weak-network proof',
              'tools': {'fonttools': fonttools_version, 'brotli': brotli.__version__},
              'woff2Specification': 'https://www.w3.org/TR/WOFF2/#Private', 'fontSubsetting': False,
              'canonicalTtfFilesRetained': True, 'privateDataTag': 'ACM1', 'assetsWritten': args.write_assets,
              'originalBytes': total_original, 'webBytes': total_web, 'reductionVsUncompressedTtf': 1 - total_web / total_original,
              'fonts': records, 'scriptSha256': sha(Path(__file__).read_bytes())}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'originalBytes': total_original, 'webBytes': total_web, 'reduction': report['reductionVsUncompressedTtf']}))

if __name__ == '__main__':
    main()
