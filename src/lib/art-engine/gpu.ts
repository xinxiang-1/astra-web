import type { ArtFrame, ArtRenderOptions } from './index'

/** Instanced glyph atlas: one draw call, original RGB, stable frame geometry. */
export function createGlyphGpu() {
  const surface = document.createElement('canvas')
  const gl = surface.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const vertex = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 cell;
  layout(location=1) in float glyph;
  layout(location=2) in vec4 color;
  uniform vec2 grid; uniform float atlasGrid; uniform float time; uniform int motion; uniform int hover; uniform vec3 pointer;
  out vec2 uv; out vec4 ink;
  void main(){
    vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
    vec2 p=corners[gl_VertexID]; vec2 offset=vec2(0);float light=1.;
    if(motion==1)light=.92+sin(time*.9+cell.x*.02+cell.y*.02)*.08;
    if(motion==2)offset=vec2(sin(cell.y*.075+time*.75)*.18,cos(cell.x*.055+time*.6)*.1);
    if(motion==3){float amount=exp(-max(0.,time)*1.4);float i=cell.y*grid.x+cell.x;offset=vec2(sin(i*12.9898)*12.,cos(i*7.13)*10.)*amount;}
    vec2 d=(cell+.5)/grid-pointer.xy;float f=exp(-dot(d,d)/.018)*pointer.z;
    float alpha=color.a;
    if(hover==1)alpha+=(1.-alpha)*f*.28;
    else if(hover==2){float distance=length(d);float ripple=sin(distance*48.-time*2.4)*f;offset+=d/max(.01,distance)*ripple*.14;alpha+=(1.-alpha)*f*.18;}
    else offset+=d*vec2(14,10)*f;
    vec2 xy=(cell+p+offset)/grid;
    gl_Position=vec4(xy.x*2.-1.,1.-xy.y*2.,0,1);
    uv=(vec2(mod(glyph,atlasGrid),floor(glyph/atlasGrid))+p)/atlasGrid;
    ink=vec4(color.rgb,alpha*light);
  }`
  const fragment = `#version 300 es
  precision highp float;uniform sampler2D atlas;in vec2 uv;in vec4 ink;out vec4 outputColor;
  void main(){outputColor=vec4(ink.rgb,ink.a*texture(atlas,uv).a);}`
  function shader(kind: number, source: string) {
    const result = gl!.createShader(kind)!
    gl!.shaderSource(result, source)
    gl!.compileShader(result)
    if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS)) {
      const error = gl!.getShaderInfoLog(result)
      gl!.deleteShader(result)
      throw new Error(error ?? 'Glyph shader compilation failed')
    }
    return result
  }
  let program: WebGLProgram
  try {
    const vs = shader(gl.VERTEX_SHADER, vertex),
      fs = shader(gl.FRAGMENT_SHADER, fragment)
    program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'Glyph pipeline failed')
  } catch {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const buffer = gl.createBuffer()!,
    texture = gl.createTexture()!,
    vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  for (const [location, size, offset] of [
    [0, 2, 0],
    [1, 1, 8],
    [2, 4, 12],
  ]) {
    gl.enableVertexAttribArray(location!)
    gl.vertexAttribPointer(location!, size!, gl.FLOAT, false, 28, offset!)
    gl.vertexAttribDivisor(location!, 1)
  }
  gl.useProgram(program)
  const uniforms = Object.fromEntries(
    ['grid', 'atlasGrid', 'time', 'motion', 'hover', 'pointer', 'atlas'].map((name) => [
      name,
      gl.getUniformLocation(program, name),
    ]),
  )
  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(uniforms.atlas!, 0)
  let current: ArtFrame | null = null,
    count = 0
  return {
    surface,
    render(frame: ArtFrame, options: ArtRenderOptions, width: number, height: number) {
      if (
        options.effectProfile === 'expressive' ||
        ['current', 'reform', 'caustics'].includes(options.motion ?? 'none') ||
        ['trail', 'rift', 'particles', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(
          options.hover ?? 'light',
        )
      )
        return false
      if (gl.isContextLost()) return false
      if (surface.width !== width || surface.height !== height) {
        surface.width = width
        surface.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (current !== frame) {
        current = frame
        const size = Math.ceil(Math.sqrt(frame.glyphs.length))
        const atlas = document.createElement('canvas')
        atlas.width = size * frame.cellWidth
        atlas.height = size * frame.cellHeight
        const ctx = atlas.getContext('2d')!
        frame.glyphs.forEach((glyph, index) =>
          ctx.drawImage(
            glyph.tile,
            (index % size) * frame.cellWidth,
            Math.floor(index / size) * frame.cellHeight,
          ),
        )
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
        gl.uniform1f(uniforms.atlasGrid!, size)
        const colorCanvas = document.createElement('canvas')
        colorCanvas.width = colorCanvas.height = 1
        const colorCtx = colorCanvas.getContext('2d')!
        colorCtx.fillStyle = frame.settings.ink
        colorCtx.fillRect(0, 0, 1, 1)
        const mono = colorCtx.getImageData(0, 0, 1, 1).data
        const cells = new Float32Array(frame.indices.length * 7)
        count = 0
        for (let i = 0; i < frame.indices.length; i++) {
          if (frame.alpha[i]! < 0.005 || frame.glyphs[frame.indices[i]!]!.coverage < 0.001) continue
          const colored = frame.settings.colored || frame.settings.mode === 'color'
          cells.set(
            [
              i % frame.columns,
              Math.floor(i / frame.columns),
              frame.indices[i]!,
              (colored ? frame.colors[i * 3]! : mono[0]!) / 255,
              (colored ? frame.colors[i * 3 + 1]! : mono[1]!) / 255,
              (colored ? frame.colors[i * 3 + 2]! : mono[2]!) / 255,
              frame.alpha[i]!,
            ],
            count * 7,
          )
          count++
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, cells.subarray(0, count * 7), gl.STATIC_DRAW)
      }
      gl.uniform2f(uniforms.grid!, frame.columns, frame.rows)
      gl.uniform1f(uniforms.time!, options.time ?? 0)
      gl.uniform1i(
        uniforms.motion!,
        { none: 0, breathe: 1, wave: 2, assemble: 3, current: 0, reform: 0, caustics: 0 }[
          options.motion ?? 'none'
        ],
      )
      gl.uniform1i(
        uniforms.hover!,
        {
          displace: 0,
          light: 1,
          ripple: 2,
          trail: 0,
          rift: 0,
          particles: 0,
          water: 0,
          silk: 0,
          vortex: 0,
          contour: 0,
          dissolve: 0,
        }[options.hover ?? 'displace'],
      )
      gl.uniform3f(
        uniforms.pointer!,
        options.pointer?.x ?? 0.5,
        options.pointer?.y ?? 0.5,
        options.pointer?.strength ?? 0,
      )
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      return true
    },
    destroy() {
      gl.deleteBuffer(buffer)
      gl.deleteTexture(texture)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      current = null
    },
  }
}
