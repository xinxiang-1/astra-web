/**
 * 第二档预览：WebGL2 图集 + 实例化绘制大量印章四边形。
 * placements 仍是矢量源；此处只负责屏上吞吐。
 */

import type { SignatureStamp } from './extract'
import type { Placement } from './layout'

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pose;   // x, y, angle, targetSize
layout(location=2) in vec4 a_uv;     // u0, v0, u1, v1
layout(location=3) in vec4 a_tint;   // r, g, b, opacity 0-1
layout(location=4) in vec2 a_glyph;  // glyphW, glyphH (atlas px before scale)

uniform vec4 u_view;       // x, y, w, h in layout space
uniform vec2 u_resolution; // canvas css*dpr pixels

out vec2 v_uv;
out vec4 v_tint;

void main() {
  float ang = a_pose.z;
  float c = cos(ang);
  float s = sin(ang);
  float stampLong = max(a_glyph.x, a_glyph.y);
  float sc = a_pose.w / max(1.0, stampLong);
  vec2 local = a_corner * a_glyph * sc;
  vec2 rot = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 world = a_pose.xy + rot;

  vec2 uv01 = (world - u_view.xy) / u_view.zw;
  vec2 clip = uv01 * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  v_uv = mix(a_uv.xy, a_uv.zw, a_corner + 0.5);
  v_tint = a_tint;
}
`

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_tint;
out vec4 outColor;

void main() {
  vec4 s = texture(u_atlas, v_uv);
  float a = s.a * v_tint.a;
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
  setBackground: (css: string) => void
  setPortrait: (img: CanvasImageSource | null, underlay?: number) => void
  setView: (view: GlViewRect) => void
  resize: (cssW: number, cssH: number, dpr?: number) => void
  redraw: () => void
  dispose: () => void
}

type AtlasEntry = { u0: number; v0: number; u1: number; v1: number; w: number; h: number }

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
  if (literal) {
    return [r / 255, g / 255, b / 255]
  }
  const d = Math.min(1, Math.max(0, depth))
  if (colorize) {
    const k = 0.22 + (1 - d) * 0.28
    const mix = 0.55 + d * 0.35
    return [
      (r * k * mix + 18 * (1 - mix)) / 255,
      (g * k * mix + 16 * (1 - mix)) / 255,
      (b * k * mix + 22 * (1 - mix)) / 255,
    ]
  }
  const v = (18 + (1 - d) * 55) / 255
  return [v, v, (18 + (1 - d) * 55 + 2) / 255]
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

function packAtlas(
  stamps: SignatureStamp[],
  maxStampLong: number,
): { canvas: HTMLCanvasElement; entries: AtlasEntry[] } {
  const pads = 2
  const cells = stamps.map((s) => downscale(s.canvas, maxStampLong))
  const sorted = cells
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.height - a.c.height)

  let atlasW = 1024
  const maxAtlas = 4096

  const layoutAt = (width: number) => {
    let shelfX = 0
    let shelfY = 0
    let shelfH = 0
    const places: { i: number; x: number; y: number; w: number; h: number }[] = []
    for (const item of sorted) {
      const w = item.c.width + pads * 2
      const h = item.c.height + pads * 2
      if (shelfX + w > width) {
        shelfX = 0
        shelfY += shelfH
        shelfH = 0
      }
      places.push({
        i: item.i,
        x: shelfX + pads,
        y: shelfY + pads,
        w: item.c.width,
        h: item.c.height,
      })
      shelfX += w
      shelfH = Math.max(shelfH, h)
    }
    return { places, height: shelfY + shelfH }
  }

  let packed = layoutAt(atlasW)
  while (packed.height > atlasW && atlasW < maxAtlas) {
    atlasW = Math.min(maxAtlas, atlasW * 2)
    packed = layoutAt(atlasW)
  }
  let atlasH = 1
  while (atlasH < packed.height) atlasH *= 2
  atlasH = Math.min(maxAtlas, Math.max(64, atlasH))

  const canvas = document.createElement('canvas')
  canvas.width = atlasW
  canvas.height = atlasH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('atlas context failed')
  ctx.clearRect(0, 0, atlasW, atlasH)
  const entries: AtlasEntry[] = new Array(stamps.length)
  for (const p of packed.places) {
    const cell = cells[p.i]!
    ctx.drawImage(cell, p.x, p.y)
    entries[p.i] = {
      u0: p.x / atlasW,
      v0: p.y / atlasH,
      u1: (p.x + p.w) / atlasW,
      v1: (p.y + p.h) / atlasH,
      w: p.w,
      h: p.h,
    }
  }
  return { canvas, entries }
}

/**
 * 创建 WebGL 预览器；不支持 WebGL2 时返回 null（调用方回退 Canvas 2D）。
 */
export function createGlStampPreview(
  canvas?: HTMLCanvasElement,
): GlStampPreview | null {
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

  const vao = gl.createVertexArray()
  const quadBuf = gl.createBuffer()
  const instBuf = gl.createBuffer()
  const atlasTex = gl.createTexture()
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

  // instance buffer layout: pose(4) + uv(4) + tint(4) + glyph(2) = 14 floats
  const STRIDE = 14
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
  gl.bindVertexArray(null)

  let placements: Placement[] = []
  let layoutW = 1
  let layoutH = 1
  let entries: AtlasEntry[] = []
  let colorize = true
  let bg: [number, number, number, number] = [0.95, 0.94, 0.91, 1]
  let view: GlViewRect = { x: 0, y: 0, w: 1, h: 1 }
  let instanceCount = 0
  let portraitUnderlay = 0
  let hasPortrait = false
  let disposed = false

  const uploadAtlas = (stamps: SignatureStamp[]) => {
    if (!stamps.length) return
    const packed = packAtlas(stamps, 256)
    entries = packed.entries
    gl.bindTexture(gl.TEXTURE_2D, atlasTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, packed.canvas)
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
    setBackground(css) {
      bg = parseCssColor(css)
    },
    setPortrait(img, underlay = 0.16) {
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
      gl.bindTexture(gl.TEXTURE_2D, atlasTex)
      gl.uniform1i(uAtlas, 0)
      gl.bindVertexArray(vao)
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
