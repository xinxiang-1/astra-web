export const artworkPresets = [
  {
    id: 'mountain',
    title: '云海之巅',
    category: '山海',
    src: '/artwork/collection-20261005/mountain.webp',
    preview: '/artwork/collection-20261005/mountain-characters.webp',
    mode: 'charset',
    color: false,
    phrase: '',
    caption: '让山岳的棱线，从云海中升起。',
  },
  {
    id: 'architecture',
    title: '悬日之城',
    category: '建筑',
    src: '/artwork/collection-20261005/architecture.webp',
    preview: '/artwork/collection-20261005/architecture-characters.webp',
    mode: 'phrase',
    color: true,
    phrase: '光筑万象',
    caption: '以文字筑起弧线，留下光的尺度。',
  },
  {
    id: 'cosmos',
    title: '星际潮汐',
    category: '宇宙',
    src: '/artwork/collection-20261005/cosmos.webp',
    preview: '/artwork/collection-20261005/cosmos-characters.webp',
    mode: 'charset',
    color: true,
    phrase: '',
    caption: '星环划过苍穹，字符承载无垠色彩。',
  },
  {
    id: 'dunes',
    title: '黑金沙海',
    category: '山海',
    src: '/artwork/collection-20261005/dunes.webp',
    preview: '/artwork/collection-20261005/dunes-characters.webp',
    mode: 'charset',
    color: false,
    phrase: '',
    caption: '风塑成曲线，光勾勒出沙的脊梁。',
  },
  {
    id: 'eagle',
    title: '苍穹之翼',
    category: '生命',
    src: '/artwork/collection-20261005/eagle.webp',
    preview: '/artwork/collection-20261005/eagle-characters.webp',
    mode: 'charset',
    color: false,
    phrase: '',
    caption: '把振翼的一瞬，留在千行字符之间。',
  },
  {
    id: 'sea',
    title: '万里归舟',
    category: '山海',
    src: '/artwork/collection-20261005/sea.webp',
    preview: '/artwork/collection-20261005/sea-characters.webp',
    mode: 'phrase',
    color: true,
    phrase: '乘风破浪',
    caption: '以帆为形，以文字写下远方。',
  },
] as const
export type ArtworkPreset = (typeof artworkPresets)[number]

const legacyPresetIds: Readonly<Record<string, string>> = {
  portrait: 'mountain',
  landscape: 'architecture',
  color: 'cosmos',
  pet: 'dunes',
  sculpture: 'eagle',
  words: 'sea',
}
/** Keep previously shared preset URLs usable after replacing the collection. */
export function findArtworkPreset(id: unknown): ArtworkPreset | undefined {
  if (typeof id !== 'string') return undefined
  return artworkPresets.find((preset) => preset.id === (legacyPresetIds[id] ?? id))
}
