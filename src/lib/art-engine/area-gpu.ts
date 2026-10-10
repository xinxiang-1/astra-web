import type { ArtFrame, ArtRenderOptions } from './types'

/** Same summed-area glyph filter as Canvas; native effects still supply the geometry. */
export function createAreaGlyphGpu(target: HTMLCanvasElement, presentToTarget = true) {
  const surface =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas')
  const gl = surface.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null
  if (!gl) return null
  let lost = false
  let rendered = false
  surface.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lost = true
  })
  const shader = (kind: number, text: string) => {
    const result = gl.createShader(kind)!
    gl.shaderSource(result, text)
    gl.compileShader(result)
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result)
      throw new Error('Area glyph shader unavailable')
    }
    return result
  }
  const vs = shader(
    gl.VERTEX_SHADER,
    `#version 300 es
precision highp float;
layout(location=0) in vec4 bounds;
layout(location=1) in vec4 filterRect;
layout(location=2) in vec4 color;
layout(location=3) in vec2 origin;
uniform vec2 viewport;
flat out vec4 filterData; flat out vec4 ink; flat out vec2 atlasOrigin; flat out vec2 position;
void main(){
vec2 p[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
vec2 xy=(bounds.xy+p[gl_VertexID]*bounds.zw)/viewport;
gl_Position=vec4(xy.x*2.-1.,1.-xy.y*2.,0,1);
position=bounds.xy; filterData=filterRect; ink=color; atlasOrigin=origin;
}`,
  )
  const fs = shader(
    gl.FRAGMENT_SHADER,
    `#version 300 es
precision highp float;
uniform sampler2D prefixes; uniform vec2 nativeSize; uniform vec2 viewport;
flat in vec4 filterData; flat in vec4 ink; flat in vec2 atlasOrigin; flat in vec2 position;
out vec4 result;
float integral(vec2 p){
p=clamp(p,vec2(0),nativeSize);
ivec2 base=ivec2(min(nativeSize-1.,floor(p)));
vec2 f=p-vec2(base); base+=ivec2(atlasOrigin);
float a=texelFetch(prefixes,base,0).r, b=texelFetch(prefixes,base+ivec2(1,0),0).r;
float c=texelFetch(prefixes,base+ivec2(0,1),0).r, d=texelFetch(prefixes,base+ivec2(1,1),0).r;
return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
void main(){
vec2 pixel=vec2(floor(gl_FragCoord.x),floor(viewport.y-gl_FragCoord.y))-position;
vec2 scale=nativeSize/filterData.zw;
vec2 a=(pixel-filterData.xy)*scale, b=(pixel+1.-filterData.xy)*scale;
float coverage=clamp((integral(b)-integral(vec2(a.x,b.y))-integral(vec2(b.x,a.y))+integral(a))/(scale.x*scale.y),0.,1.);
float alpha=coverage*ink.a;
if(alpha<.00001)discard;
result=vec4(ink.rgb,alpha);
}`,
  )
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    throw new Error('Area glyph program unavailable')
  }
  const texture = gl.createTexture()!,
    buffer = gl.createBuffer()!,
    vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  for (const [location, size, offset] of [
    [0, 4, 0],
    [1, 4, 16],
    [2, 4, 32],
    [3, 2, 48],
  ]) {
    gl.enableVertexAttribArray(location!)
    gl.vertexAttribPointer(location!, size!, gl.FLOAT, false, 56, offset!)
    gl.vertexAttribDivisor(location!, 1)
  }
  const viewport = gl.getUniformLocation(program, 'viewport'),
    nativeSize = gl.getUniformLocation(program, 'nativeSize')
  let glyphs: ArtFrame['glyphs'] | null = null,
    atlasKeys = '',
    grid = 0
  let values = new Float32Array(0)
  let atlasBytes = 0,
    instanceBufferBytes = 0
  const probe =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas')
  probe.width = probe.height = 1
  const probeCtx = probe.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const backgroundColors = new Map<string, number[]>()
  const rgba = (color: string) => {
    const existing = backgroundColors.get(color)
    if (existing) return existing
    probeCtx.clearRect(0, 0, 1, 1)
    probeCtx.fillStyle = '#000'
    probeCtx.fillStyle = color
    probeCtx.fillRect(0, 0, 1, 1)
    const value = [...probeCtx.getImageData(0, 0, 1, 1).data].map((n) => n / 255)
    if (backgroundColors.size < 64) backgroundColors.set(color, value)
    return value
  }
  const output = target.getContext('2d')!
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const canRaster = (frame: ArtFrame, width: number, height: number) => {
    if (lost || gl.isContextLost() || width * height * 4 > 32 * 1024 * 1024) return false
    const nextGrid = Math.ceil(Math.sqrt(frame.glyphs.length))
    const aw = nextGrid * (frame.cellWidth + 1),
      ah = nextGrid * (frame.cellHeight + 1)
    return Math.max(aw, ah) <= maxTextureSize && aw * ah * 4 <= 4 * 1024 * 1024
  }
  return {
    canRaster,
    get cacheStats() {
      return {
        active: rendered,
        atlasBytes,
        instanceCpuBytes: values.byteLength,
        instanceBufferBytes,
        framebufferBytes: surface.width * surface.height * 4,
        atlasLimit: 4 * 1024 * 1024,
        framebufferLimit: 32 * 1024 * 1024,
      }
    },
    reset() {
      rendered = false
    },
    get rendered() {
      return rendered
    },
    bitmap() {
      return rendered && surface instanceof OffscreenCanvas ? surface.transferToImageBitmap() : null
    },
    rasterBatch(
      frame: ArtFrame,
      options: ArtRenderOptions,
      width: number,
      height: number,
      prefixMap: Map<number, Float32Array>,
      commands: Float64Array,
      count: number,
    ) {
      rendered = false
      if (!canRaster(frame, width, height)) return false
      const nextGrid = Math.ceil(Math.sqrt(frame.glyphs.length))
      const aw = nextGrid * (frame.cellWidth + 1),
        ah = nextGrid * (frame.cellHeight + 1)
      if (surface.width !== width || surface.height !== height) {
        surface.width = width
        surface.height = height
      }
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const keys = [...prefixMap.keys()].sort((a, b) => a - b).join(',')
      if (glyphs !== frame.glyphs || keys !== atlasKeys) {
        const atlas = new Float32Array(aw * ah)
        for (const [index, prefix] of prefixMap) {
          const x = (index % nextGrid) * (frame.cellWidth + 1),
            y = Math.floor(index / nextGrid) * (frame.cellHeight + 1)
          for (let row = 0; row <= frame.cellHeight; row++)
            atlas.set(
              prefix.subarray(row * (frame.cellWidth + 1), (row + 1) * (frame.cellWidth + 1)),
              (y + row) * aw + x,
            )
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, aw, ah, 0, gl.RED, gl.FLOAT, atlas)
        atlasBytes = atlas.byteLength
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        glyphs = frame.glyphs
        grid = nextGrid
        atlasKeys = keys
      }
      if (values.length < count * 14) values = new Float32Array(count * 14)
      for (let cell = 0; cell < count; cell++) {
        const at = cell * 9,
          index = commands[at]!,
          px = commands[at + 1]!,
          py = commands[at + 2]!
        const w = commands[at + 3]!,
          h = commands[at + 4]!,
          left = Math.floor(px),
          top = Math.floor(py)
        const fx = Math.round((px - left) * 32) / 32,
          fy = Math.round((py - top) * 32) / 32
        values.set(
          [
            left,
            top,
            Math.ceil(w + fx),
            Math.ceil(h + fy),
            fx,
            fy,
            w,
            h,
            commands[at + 6]!,
            commands[at + 7]!,
            commands[at + 8]!,
            commands[at + 5]!,
            (index % grid) * (frame.cellWidth + 1),
            Math.floor(index / grid) * (frame.cellHeight + 1),
          ],
          cell * 14,
        )
      }
      const bg = options.transparent ? [0, 0, 0, 0] : rgba(frame.settings.background)
      gl.viewport(0, 0, width, height)
      gl.clearColor(bg[0]! * bg[3]!, bg[1]! * bg[3]!, bg[2]! * bg[3]!, bg[3]!)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(viewport, width, height)
      gl.uniform2f(nativeSize, frame.cellWidth, frame.cellHeight)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, values.subarray(0, count * 14), gl.DYNAMIC_DRAW)
      instanceBufferBytes = count * 14 * 4
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      if (gl.getError() !== gl.NO_ERROR) {
        lost = true
        return false
      }
      if (presentToTarget) {
        output.save()
        output.globalAlpha = 1
        output.globalCompositeOperation = 'copy'
        output.drawImage(surface, 0, 0)
        output.restore()
      }
      rendered = true
      return true
    },
    destroy() {
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      glyphs = null
      values = new Float32Array(0)
      backgroundColors.clear()
      surface.width = surface.height = 1
    },
  }
}
