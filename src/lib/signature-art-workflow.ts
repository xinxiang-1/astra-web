import { ART_ENGINE_VERSION } from './art-engine'
import { ART_RECIPES, artRecipeSettings } from './art-recipes'
import type { ArtProject } from './art-projects'
import { PREVIEW_MONO_FONT } from './ascii/constants'

/** A raster derivative, not an editable replacement for the original signature project. */
export function signatureArtProject(
  source: File,
  thumbnail: string,
  name: string,
  background: string,
  recipeId: string,
): ArtProject {
  const recipe = ART_RECIPES.find((item) => item.id === recipeId)
  if (!recipe) throw new Error('请选择有效的效果配方')
  return {
    id: crypto.randomUUID(),
    name: `${name || '签名画像'} · 动态字符`.slice(0, 60),
    updatedAt: Date.now(),
    kind: 'image',
    source,
    thumbnail,
    engineVersion: ART_ENGINE_VERSION,
    settings: {
      editorEngine: 'calibrated',
      artMode: 'color',
      artQuality: 'faithful',
      mode: 'charset',
      phraseColor: true,
      charsetKey: 'dense',
      customCharset: '',
      columns: 180,
      resolutionKey: 'high',
      contrast: 0.2,
      exposure: 0,
      normalizeTone: true,
      ditherStrength: 0.25,
      invert: false,
      previewFontKey: 'consolas',
      previewFontFamily: PREVIEW_MONO_FONT,
      previewAspect: 0.55,
      exportFontKey: 'consolas',
      exportFontFamily: PREVIEW_MONO_FONT,
      exportAspect: 0.55,
      backgroundColor: background,
      foregroundColor: '#eeeae2',
      ...artRecipeSettings(recipe),
    },
  }
}
