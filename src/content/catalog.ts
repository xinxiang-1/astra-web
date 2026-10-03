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
    line: '把图片与短视频转成中文铺字和彩色字符作品，免费导出图片、视频和网页',
    tag: '主推',
  },
  {
    to: '/ascii-loop',
    name: '循环嵌入',
    line: '让短视频循环播放，用流动的文字延伸画面，导出可嵌入的动态网页',
    tag: '实验',
  },
  {
    to: '/ascii-live',
    name: '动态字符',
    line: '探索图像变成动态文字的过程，可上传图片或视频，感受指尖的光影',
    tag: '实验',
  },
  {
    to: '/signature-portrait',
    name: '签名画像',
    line: '用亲手写下的名字或书写字体织成肖像，远看光影，近看笔迹',
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
    line: '让光穿过棱镜，在空间中折射出色彩；可调整底色和画质',
    tag: '门面',
  },
  {
    to: '/black-hole',
    name: '黑洞',
    line: '探索吸积盘与引力透镜，体验深空中的光与运动',
  },
  {
    to: '/fluid',
    name: '流体',
    line: '搅动光的流体，让运动沿着你的指尖生长',
  },
  {
    to: '/webgl-fluid',
    name: '彩烟',
    line: '以指尖绘出彩色烟雾，自由调整颜色与流动方式',
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

export const studioRouteNames = ['studio', 'prism', 'black-hole', 'fluid', 'webgl-fluid'] as const

export const authRouteNames = ['login', 'register', 'forgot', 'wechat-login'] as const
