/** Shared IA catalog for Tools / Studio — keep nav + hubs + home in sync. */

export type CatalogItem = {
  to: string
  name: string
  line: string
  /** Optional short label, e.g. 主推 */
  tag?: string
}

export const toolsCatalog: readonly CatalogItem[] = [
  {
    to: '/ascii-art',
    name: '字符画',
    line: '上传图片或短视频，本地转成可晒的中文铺字 / 彩色字符画',
    tag: '主推',
  },
  {
    to: '/ascii-loop',
    name: '循环嵌入',
    line: '循环视频转字符画：抠背景格换成流动字符，可导出 HTML',
    tag: '实验',
  },
  {
    to: '/ascii-live',
    name: '动态字符',
    line: '大理石胸像转动态字符，悬停白字跟随，可上传图片或视频',
    tag: '实验',
  },
  {
    to: '/signature-portrait',
    name: '签名画像',
    line: '手写签名抠成印章，按画像明暗多角度拼接（试验页）',
    tag: '实验',
  },
  {
    to: '/file-upload',
    name: '文件预览',
    line: '本地上传，浏览器内预览 Office / PDF，不上传服务器',
  },
] as const

export const studioCatalog: readonly CatalogItem[] = [
  {
    to: '/prism',
    name: 'Prism',
    line: '色散与折射的 WebGPU 英雄背景，暗亮主题可切换',
    tag: '门面',
  },
  {
    to: '/black-hole',
    name: '黑洞',
    line: '可交互吸积盘与引力透镜视场',
  },
  {
    to: '/fluid',
    name: '流体',
    line: '指针搅动的实时流体场',
  },
  {
    to: '/webgl-fluid',
    name: '彩烟',
    line: '轻量彩烟，鼠标即绘',
  },
] as const

export const toolRouteNames = [
  'tools',
  'ascii-art',
  'ascii-loop',
  'ascii-live',
  'signature-portrait',
  'file-upload',
  'file-preview',
] as const

export const studioRouteNames = [
  'studio',
  'prism',
  'black-hole',
  'fluid',
  'webgl-fluid',
] as const

export const authRouteNames = [
  'login',
  'register',
  'forgot',
  'wechat-login',
] as const
