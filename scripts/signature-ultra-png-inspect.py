"""Validate every chunk/row and inspect native crops without decoding the full 16K image."""
import sys,json,struct,zlib,binascii,hashlib
from pathlib import Path
import numpy as np
from PIL import Image

p=Path(sys.argv[1]); report=json.loads((p/'report.json').read_text(encoding='utf-8-sig')); results=[]
for case in report['cases']:
    file=p/case.get('file',f"real-{case['longSide']}.png")
    f=file.open('rb');assert f.read(8)==b'\x89PNG\r\n\x1a\n'
    dec=zlib.decompressobj();pending=b'';rows=0;filters=set();width=height=0;previous=None
    rgbaHash=hashlib.sha256();idatChunks=0
    crops=[np.zeros((c['height'],c['width'],4),dtype=np.uint8) for c in case['crops']]
    step=16;overview=np.zeros(((case['height']+step-1)//step,(case['width']+step-1)//step,4),dtype=np.uint8)
    accumulator=np.zeros((overview.shape[1],4),dtype=np.uint32);sampleRows=0
    def consume(raw):
        global pending,rows,previous,sampleRows,accumulator
        pending+=raw;n=width*4
        while len(pending)>=n+1:
            kind=pending[0];filters.add(kind)
            line=np.frombuffer(pending[1:n+1],dtype=np.uint8).reshape(width,4);pending=pending[n+1:]
            if kind==1:line=(np.cumsum(line,axis=0,dtype=np.uint64)&255).astype(np.uint8)
            elif kind==2:line=((line.astype(np.uint16)+previous)&255).astype(np.uint8)
            else:raise AssertionError('Unknown filter')
            rgbaHash.update(line.tobytes())
            for crop,c in zip(crops,case['crops']):
                if c['y']<=rows<c['y']+c['height']:crop[rows-c['y']]=line[c['x']:c['x']+c['width']]
            accumulator+=line[::step];sampleRows+=1
            if rows%step==step-1 or rows==height-1:
                overview[rows//step]=(accumulator//sampleRows).astype(np.uint8);accumulator.fill(0);sampleRows=0
            previous=line;rows+=1
    while True:
        length=struct.unpack('>I',f.read(4))[0];kind=f.read(4);data=f.read(length);crc=struct.unpack('>I',f.read(4))[0]
        assert(binascii.crc32(kind+data)&0xffffffff)==crc
        if kind==b'IHDR':
            width,height,depth,col,comp,fil,interlace=struct.unpack('>IIBBBBB',data)
            assert(width,height)==(case['width'],case['height'])
            assert(depth,col,comp,fil,interlace)==(8,6,0,0,0);previous=np.zeros((width,4),dtype=np.uint8)
        elif kind==b'IDAT':
            idatChunks+=1
            consume(dec.decompress(data,(width*4+1)*16))
            while dec.unconsumed_tail:consume(dec.decompress(dec.unconsumed_tail,(width*4+1)*16))
        elif kind==b'IEND':break
    consume(dec.flush());assert rows==height and not pending and dec.eof and not dec.unused_data and not f.read()
    label=case.get('id',case['longSide'])
    Image.fromarray(overview).save(p/f"overview-{label}.png")
    for i,crop in enumerate(crops):Image.fromarray(crop).save(p/f"native-{label}-{i}.png")
    results.append(dict(file=file.name,width=width,height=height,rows=rows,channels=width*height*4,crcValid=True,filters=sorted(filters),idatChunks=idatChunks,rgbaSha256=rgbaHash.hexdigest(),fileBytes=file.stat().st_size,fullImageAllocated=False))
(p/'decoded.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf8')
print(json.dumps(results))
