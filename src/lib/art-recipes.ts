import type { ArtHover, ArtMotion } from './art-engine/types'

/** Compositions of existing effects. No new renderer or unpersisted effect state. */
export const ART_RECIPES: ReadonlyArray<{
  id: string
  name: string
  description: string
  motion: ArtMotion
  hover: ArtHover | 'none'
  speed: number
  strength: number
  hoverStrength: number
  radius: number
}> = [
  {
    id: 'fluid-reveal',
    name: '流体揭幕 · 撕裂试用',
    description: '轨道入场后展示主体，划动拉开真实字符，再自然回弹。',
    motion: 'assemble',
    hover: 'rift',
    speed: 0.7,
    strength: 0.55,
    hoverStrength: 0.65,
    radius: 0.38,
  },
  {
    id: 'glyph-bloom',
    name: '字符绽放 · 聚散试用',
    description: '片层绽放与指针聚散组合；暂停环境动画后仍可划动散开、归位。',
    motion: 'reform',
    hover: 'particles',
    speed: 0.6,
    strength: 0.5,
    hoverStrength: 0.65,
    radius: 0.32,
  },
  {
    id: 'hologram',
    name: '全息显影',
    description: '光迹扫过原作笔画，移动时留下流体拖尾，适合轮廓明确的作品。',
    motion: 'caustics',
    hover: 'trail',
    speed: 0.75,
    strength: 0.45,
    hoverStrength: 0.65,
    radius: 0.38,
  },
]

export function artRecipeSettings(recipe: (typeof ART_RECIPES)[number]) {
  return {
    artMotion: recipe.motion,
    artHover: recipe.hover,
    artMotionSpeed: recipe.speed,
    artMotionStrength: recipe.strength,
    artMotionStyle: 'cinematic',
    artEffectProfile: 'expressive',
    hoverStrength: recipe.hoverStrength,
    hoverRadius: recipe.radius,
  }
}
