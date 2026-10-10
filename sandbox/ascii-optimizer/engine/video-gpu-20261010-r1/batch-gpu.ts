import type { ArtFrame } from '../../../../src/lib/art-engine/types'
/** Research only: same native glyph geometry, one instanced draw, cached glyph atlas. */
export function createBatchGpu() {
  const surface = document.createElement('canvas')
  const gl = surface.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true })
  if (!gl) return null
  const extension = gl.getExtension('WEBGL_debug_renderer_info')
  const device = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  const shader = (type: number, code: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, code); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!)
    return s
  }
  const vs = shader(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
layout(location=0) in vec4 rect;
layout(location=1) in float glyph;
layout(location=2) in vec4 color;
uniform vec2 viewport; uniform float atlasGrid;
out vec2 uv; out vec4 ink;
void main(){
vec2 p[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
vec2 c=p[gl_VertexID]; vec2 xy=(rect.xy+c*rect.zw)/viewport;
gl_Position=vec4(xy.x*2.-1.,1.-xy.y*2.,0,1);
uv=(vec2(mod(glyph,atlasGrid),floor(glyph/atlasGrid))+c)/atlasGrid; ink=color;
}`)
  const fs = shader(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; uniform sampler2D atlas; in vec2 uv; in vec4 ink; out vec4 result;
void main(){result=vec4(ink.rgb,ink.a*texture(atlas,uv).a);}`)
  const program = gl.createProgram()!
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!)
  gl.deleteShader(vs); gl.deleteShader(fs)
  const texture = gl.createTexture()!, buffer = gl.createBuffer()!, vao = gl.createVertexArray()!
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  for (const [location, size, offset] of [[0, 4, 0], [1, 1, 16], [2, 4, 20]]) {
    gl.enableVertexAttribArray(location!); gl.vertexAttribPointer(location!, size!, gl.FLOAT, false, 36, offset!); gl.vertexAttribDivisor(location!, 1)
  }
  const viewport = gl.getUniformLocation(program, 'viewport'), atlasGrid = gl.getUniformLocation(program, 'atlasGrid')
  let values = new Float32Array(0), count = 0, glyphs: ArtFrame['glyphs'] | null = null
  const colorCanvas = document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true })!
  const colors = new Map<string, number[]>()
  const rgb = (color: string) => {
    let result = colors.get(color)
    if (result) return result
    if (color.startsWith('rgb(')) result = color.slice(4, -1).split(',').map((x) => Number(x) / 255)
    else { colorCtx.fillStyle = color; colorCtx.fillRect(0, 0, 1, 1); result = [...colorCtx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((x) => x / 255) }
    if (colors.size < 8192) colors.set(color, result)
    return result
  }
  return {
    surface, device,
    hooks: {
      beginBatch(frame: ArtFrame, width: number, height: number) {
        if (frame.settings.softwareRaster || frame.settings.rasterQuality === 'supersampled') throw new Error('Research candidate supports video/classic raster only')
        count = 0
        if (values.length < frame.indices.length * 9) values = new Float32Array(frame.indices.length * 9)
        if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height }
        gl.useProgram(program); gl.bindVertexArray(vao); gl.bindTexture(gl.TEXTURE_2D, texture)
        if (glyphs !== frame.glyphs) {
          glyphs = frame.glyphs
          const grid = Math.ceil(Math.sqrt(glyphs.length)), atlas = document.createElement('canvas')
          atlas.width = grid * frame.cellWidth; atlas.height = grid * frame.cellHeight
          const ctx = atlas.getContext('2d')!
          glyphs.forEach((g, i) => ctx.drawImage(g.tile, i % grid * frame.cellWidth, Math.floor(i / grid) * frame.cellHeight))
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          gl.uniform1f(atlasGrid, grid)
        }
        const bg = rgb(frame.settings.background)
        gl.viewport(0, 0, width, height); gl.clearColor(bg[0]!, bg[1]!, bg[2]!, 1); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform2f(viewport, width, height)
      },
      glyphBatch(index: number, color: string, alpha: number, x: number, y: number, width: number, height: number) {
        const c = rgb(color), offset = count++ * 9
        values.set([x, y, width, height, index, c[0]!, c[1]!, c[2]!, alpha], offset)
      },
      endBatch() {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values.subarray(0, count * 9), gl.DYNAMIC_DRAW)
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      },
    },
    finish() { gl.finish() },
    destroy() { gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteVertexArray(vao); gl.deleteProgram(program); colors.clear(); values = new Float32Array(0); gl.getExtension('WEBGL_lose_context')?.loseContext() },
  }
}
