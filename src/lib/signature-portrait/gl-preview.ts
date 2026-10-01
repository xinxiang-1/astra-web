/**
 * WebGL2 分层纹理 + 实例化绘制；独立 mipmaps 保留缩小后的完整笔迹。
 * placements 仍是矢量源；此处只负责屏上吞吐。
 */

import type { SignatureStamp } from './extract'
import type { Placement } from './layout'
import { signatureTint } from './render-style'

// Keep production on Canvas until test:signature-gpu passes. Experiments must
// opt in explicitly; supporting WebGL2 is not a visual quality certificate.
export const SIGNATURE_GPU_PREVIEW_VERIFIED: boolean = false

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pose;   // x, y, angle, targetSize
layout(location=2) in vec4 a_uv;     // u0, v0, u1, v1
layout(location=3) in vec4 a_tint;   // r, g, b, opacity 0-1
layout(location=4) in vec2 a_glyph;  // glyphW, glyphH (atlas px before scale)
layout(location=5) in vec4 a_cover;
layout(location=6) in float a_layer;

uniform vec4 u_view;       // x, y, w, h in layout space
uniform vec2 u_resolution; // canvas css*dpr pixels
uniform bool u_cover;

out vec2 v_uv;
out vec4 v_tint;
out vec4 v_cover;
out vec2 v_corner;
flat out float v_layer;

void main() {
  float ang = a_pose.z;
  float c = cos(ang);
  float s = sin(ang);
  float stampLong = max(a_glyph.x, a_glyph.y);
  float sc = a_pose.w / max(1.0, stampLong);
  vec2 corner = u_cover ? a_corner * vec2(1.04, .76) : a_corner;
  // Leave one screen pixel around the glyph for its filtered alpha. Clipping
  // the quad at the source bounds otherwise cuts off ink at very small sizes.
  if (!u_cover) {
    float pixel = max(u_view.z / u_resolution.x, u_view.w / u_resolution.y);
    corner *= 1. + vec2(2. * pixel) / max(vec2(.001), a_glyph * sc);
  }
  vec2 local = corner * a_glyph * sc;
  vec2 rot = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 world = a_pose.xy + rot;

  vec2 uv01 = (world - u_view.xy) / u_view.zw;
  vec2 clip = uv01 * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  v_uv = mix(a_uv.xy, a_uv.zw, corner + 0.5);
  v_tint = a_tint;
  v_cover = a_cover;
  v_corner = corner;
  v_layer = a_layer;
}
`

const FS = `#version 300 es
precision highp float;
uniform highp sampler2DArray u_atlas;
uniform bool u_cover;
in vec2 v_uv;
in vec4 v_tint;
in vec4 v_cover;
in vec2 v_corner;
flat in float v_layer;
out vec4 outColor;

void main() {
  if (u_cover) {
    float d = length(v_corner / vec2(.52, .38));
    float alpha = v_cover.a * (1. - smoothstep(1. - fwidth(d), 1. + fwidth(d), d));
    outColor = vec4(v_cover.rgb * alpha, alpha);
    return;
  }
  vec2 dx = dFdx(v_uv) * .5, dy = dFdy(v_uv) * .5;
  float alpha = 0.;
  for (int y = -1; y <= 1; y += 2) {
    for (int x = -1; x <= 1; x += 2) {
      vec2 uv = v_uv + (float(x) * dx + float(y) * dy) * .5;
      alpha += textureGrad(u_atlas, vec3(uv, v_layer), dx, dy).a * .25;
    }
  }
  float a = alpha * v_tint.a;
  // 印章为透明底墨迹；用 tint 着色（与 canvas source-in 接近）
  vec3 rgb = v_tint.rgb * a;
  outColor = vec4(rgb, a);
}
`

export type GlViewRect = { x: number; y: number; w: number; h: number }

export type GlStampPreview = {
  readonly ok: true
  canvas: HTMLCanvasElement
  setStamps: (stamps: SignatureStamp[]) => void
  setPlacements: (placements: Placement[], layoutW: number, layoutH: number) => void
  setColorize: (on: boolean) => void
  setCoverFill: (on: boolean) => void
  setBackground: (css: string) => void
  setPortrait: (img: CanvasImageSource | null, underlay?: number) => void
  setView: (view: GlViewRect) => void
  resize: (cssW: number, cssH: number, dpr?: number) => void
  redraw: () => void
  dispose: () => void
}

type AtlasEntry = { u0: number; v0: number; u1: number; v1: number; w: number; h: number; layer: number }

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'shader error'
    gl.deleteShader(sh)
    throw new Error(log)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'link error'
    gl.deleteProgram(prog)
    throw new Error(log)
  }
  return prog
}

function parseCssColor(css: string): [number, number, number, number] {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d')
  if (!ctx) return [0.95, 0.94, 0.91, 1]
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0]! / 255, d[1]! / 255, d[2]! / 255, d[3]! / 255]
}

function tintRgb(
  colorize: boolean,
  r: number,
  g: number,
  b: number,
  depth: number,
  literal = false,
): [number, number, number] {
  return signatureTint(colorize, r, g, b, depth, literal).map(channel => channel / 255) as [number, number, number]
}

function downscale(src: HTMLCanvasElement, maxLong: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height)
  if (long <= maxLong) return src
  const s = maxLong / long
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(src.width * s))
  out.height = Math.max(1, Math.round(src.height * s))
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

/**
 * 创建 WebGL 预览器；不支持 WebGL2 时返回 null（调用方回退 Canvas 2D）。
 */
export function createGlStampPreview(
  canvas?: HTMLCanvasElement,
  options: { allowUnverified?: boolean } = {},
): GlStampPreview | null {
  if (!SIGNATURE_GPU_PREVIEW_VERIFIED && !options.allowUnverified) return null
  const el = canvas ?? document.createElement('canvas')
  const gl = el.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null

  let prog: WebGLProgram
  try {
    prog = link(gl, VS, FS)
  } catch {
    return null
  }

  const uView = gl.getUniformLocation(prog, 'u_view')
  const uRes = gl.getUniformLocation(prog, 'u_resolution')
  const uAtlas = gl.getUniformLocation(prog, 'u_atlas')
  const uCover = gl.getUniformLocation(prog, 'u_cover')

  const vao = gl.createVertexArray()
  const quadBuf = gl.createBuffer()
  const instBuf = gl.createBuffer()
  let atlasTex = gl.createTexture()
  const portraitTex = gl.createTexture()
  // unit quad corners: (-0.5,-0.5) .. (0.5,0.5)
  const corners = new Float32Array([
    -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ])
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(0, 0)

  // pose(4) + uv(4) + tint(4) + glyph(2) + cover(4) + layer(1)
  const STRIDE = 19
  const BYTES = STRIDE * 4
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf)
  const bindInst = (loc: number, size: number, offset: number) => {
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, BYTES, offset)
    gl.vertexAttribDivisor(loc, 1)
  }
  bindInst(1, 4, 0)
  bindInst(2, 4, 16)
  bindInst(3, 4, 32)
  bindInst(4, 2, 48)
  bindInst(5, 4, 56)
  bindInst(6, 1, 72)
  gl.bindVertexArray(null)

  let placements: Placement[] = []
  let layoutW = 1
  let layoutH = 1
  let entries: AtlasEntry[] = []
  let colorize = true
  let coverFill = false
  let bg: [number, number, number, number] = [0.95, 0.94, 0.91, 1]
  let view: GlViewRect = { x: 0, y: 0, w: 1, h: 1 }
  let instanceCount = 0
  let portraitUnderlay = 0
  let hasPortrait = false
  let disposed = false

  const uploadAtlas = (stamps: SignatureStamp[]) => {
    entries = []
    if (!stamps.length) return
    if (stamps.length > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) throw new Error('签名模板超出 GPU 限制')
    // At most ~64 MiB including mipmaps. Each signature has its own layer,
    // so even the smallest mip level cannot bleed into another handwriting.
    let side = Math.min(512, gl.getParameter(gl.MAX_TEXTURE_SIZE))
    while (side > 32 && side * side * stamps.length * 4 * 4 / 3 > 64 * 1024 * 1024) side /= 2
    gl.deleteTexture(atlasTex)
    atlasTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const levels = Math.floor(Math.log2(side)) + 1
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, side, side, stamps.length)
    const layerCanvas = document.createElement('canvas')
    layerCanvas.width = layerCanvas.height = side
    const context = layerCanvas.getContext('2d')
    if (!context) throw new Error('无法创建签名纹理')
    const mipCanvas = document.createElement('canvas')
    const mipContext = mipCanvas.getContext('2d')
    if (!mipContext) throw new Error('无法创建签名缩小纹理')
    for (let layer = 0; layer < stamps.length; layer++) {
      const stamp = stamps[layer]!
      const cell = downscale(stamp.canvas, side - 4)
      const x = (side - cell.width) / 2, y = (side - cell.height) / 2
      context.clearRect(0, 0, side, side)
      context.drawImage(cell, x, y)
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, side, side, 1, gl.RGBA, gl.UNSIGNED_BYTE, layerCanvas)
      for (let level = 1; level < levels; level++) {
        mipCanvas.width = mipCanvas.height = side >> level
        mipContext.imageSmoothingEnabled = true
        mipContext.imageSmoothingQuality = 'high'
        mipContext.drawImage(layerCanvas, 0, 0, mipCanvas.width, mipCanvas.height)
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, mipCanvas.width, mipCanvas.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, mipCanvas)
      }
      entries.push({ u0: x / side, v0: y / side, u1: (x + cell.width) / side, v1: (y + cell.height) / side, w: stamp.canvas.width, h: stamp.canvas.height, layer })
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error('签名纹理上传失败')
  }

  const rebuildInstances = () => {
    if (!entries.length || !placements.length) {
      instanceCount = 0
      return
    }
    // 大章先画（与 canvas 路径一致）
    const order = [...placements].sort(
      (a, b) => b.targetSize - a.targetSize || a.depth - b.depth,
    )
    const data = new Float32Array(order.length * STRIDE)
    let o = 0
    for (const p of order) {
      const e = entries[p.stampIndex] ?? entries[0]
      if (!e) continue
      const [tr, tg, tb] = tintRgb(
        colorize,
        p.tint.r,
        p.tint.g,
        p.tint.b,
        p.depth,
        Boolean(p.tintLiteral),
      )
      data[o++] = p.x
      data[o++] = p.y
      data[o++] = p.angle
      data[o++] = p.targetSize
      data[o++] = e.u0
      data[o++] = e.v0
      data[o++] = e.u1
      data[o++] = e.v1
      data[o++] = tr
      data[o++] = tg
      data[o++] = tb
      data[o++] = Math.min(1, Math.max(0, p.strength))
      data[o++] = e.w
      data[o++] = e.h
      data[o++] = p.tint.r / 255
      data[o++] = p.tint.g / 255
      data[o++] = p.tint.b / 255
      data[o++] = Math.max(0, Math.min(1, .14 + p.depth * .28)) * Math.max(0, Math.min(1, p.strength))
      data[o++] = e.layer
    }
    instanceCount = order.length
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  }

  const uploadPortrait = (img: CanvasImageSource | null) => {
    if (!img) {
      hasPortrait = false
      return
    }
    gl.bindTexture(gl.TEXTURE_2D, portraitTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource)
      hasPortrait = true
    } catch {
      hasPortrait = false
    }
  }

  // simple full-screen portrait pass via 2D overlay on same canvas before GL? 
  // Better: draw bg + portrait with gl clear and a tiny textured quad program.
  // Keep it simple: clear to bg, then stamps; draw portrait underlay by reading into 2d... 
  // Actually use gl to draw portrait as one textured quad with separate mini program.

  const portraitProg = (() => {
    try {
      return link(
        gl,
        `#version 300 es
        layout(location=0) in vec2 a_pos;
        out vec2 v_uv;
        void main(){
          v_uv = a_pos * 0.5 + 0.5;
          v_uv.y = 1.0 - v_uv.y;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }`,
        `#version 300 es
        precision highp float;
        uniform sampler2D u_tex;
        uniform float u_alpha;
        in vec2 v_uv;
        out vec4 outColor;
        void main(){
          vec4 c = texture(u_tex, v_uv);
          outColor = vec4(c.rgb * u_alpha, u_alpha);
        }`,
      )
    } catch {
      return null
    }
  })()
  const portraitVao = gl.createVertexArray()
  const portraitQuad = gl.createBuffer()
  gl.bindVertexArray(portraitVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, portraitQuad)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  const uPortraitTex = portraitProg ? gl.getUniformLocation(portraitProg, 'u_tex') : null
  const uPortraitAlpha = portraitProg ? gl.getUniformLocation(portraitProg, 'u_alpha') : null

  const api: GlStampPreview = {
    ok: true,
    canvas: el,
    setStamps(stamps) {
      if (disposed) return
      uploadAtlas(stamps)
      rebuildInstances()
    },
    setPlacements(next, w, h) {
      if (disposed) return
      placements = next
      layoutW = Math.max(1, w)
      layoutH = Math.max(1, h)
      view = { x: 0, y: 0, w: layoutW, h: layoutH }
      rebuildInstances()
    },
    setColorize(on) {
      if (disposed) return
      colorize = on
      rebuildInstances()
    },
    setCoverFill(on) { coverFill = on },
    setBackground(css) {
      bg = parseCssColor(css)
    },
    setPortrait(img, underlay = 0) {
      if (disposed) return
      portraitUnderlay = underlay
      uploadPortrait(img)
    },
    setView(next) {
      view = {
        x: next.x,
        y: next.y,
        w: Math.max(1e-3, next.w),
        h: Math.max(1e-3, next.h),
      }
    },
    resize(cssW, cssH, dpr = Math.min(2, window.devicePixelRatio || 1)) {
      if (disposed) return
      const pw = Math.max(1, Math.round(cssW * dpr))
      const ph = Math.max(1, Math.round(cssH * dpr))
      if (el.width !== pw || el.height !== ph) {
        el.width = pw
        el.height = ph
      }
      el.style.width = `${cssW}px`
      el.style.height = `${cssH}px`
      gl.viewport(0, 0, pw, ph)
    },
    redraw() {
      if (disposed) return
      gl.viewport(0, 0, el.width, el.height)
      gl.clearColor(bg[0], bg[1], bg[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

      if (hasPortrait && portraitProg && portraitUnderlay > 0) {
        gl.useProgram(portraitProg)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, portraitTex)
        gl.uniform1i(uPortraitTex, 0)
        gl.uniform1f(uPortraitAlpha, portraitUnderlay)
        gl.bindVertexArray(portraitVao)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        gl.bindVertexArray(null)
      }

      if (instanceCount <= 0) return
      gl.useProgram(prog)
      gl.uniform4f(uView, view.x, view.y, view.w, view.h)
      gl.uniform2f(uRes, el.width, el.height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex)
      gl.uniform1i(uAtlas, 0)
      gl.bindVertexArray(vao)
      if (coverFill) { gl.uniform1i(uCover, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount) }
      gl.uniform1i(uCover, 0)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount)
      gl.bindVertexArray(null)
    },
    dispose() {
      if (disposed) return
      disposed = true
      gl.deleteBuffer(quadBuf)
      gl.deleteBuffer(instBuf)
      gl.deleteBuffer(portraitQuad)
      gl.deleteVertexArray(vao)
      gl.deleteVertexArray(portraitVao)
      gl.deleteTexture(atlasTex)
      gl.deleteTexture(portraitTex)
      gl.deleteProgram(prog)
      if (portraitProg) gl.deleteProgram(portraitProg)
    },
  }

  return api
}

export function isGlStampPreview(
  v: GlStampPreview | null | undefined,
): v is GlStampPreview {
  return Boolean(v && v.ok)
}
