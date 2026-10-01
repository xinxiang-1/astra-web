// Generated from verified original starter delivery. See scripts/publish-starter-demos.mjs.
export const starterTemplates = [
  {
    "id": "orbital-light",
    "name": "星环余光",
    "category": "光影",
    "modeLabel": "光影字符",
    "motionLabel": "光息",
    "hoverLabel": "光晕",
    "suitedTo": "明暗层次清楚、背景简洁的静物或几何构图；主体周围保留空间。",
    "adjust": "先替换自己的照片，再调曝光和对比度；细节过密时降低列数。",
    "version": "1.0.0",
    "engineVersion": "2.2.0",
    "assets": {
      "project": {
        "path": "templates/starter-v1/orbital-light/project.astra",
        "bytes": 759132,
        "sha256": "738100d51a28b725e2333a549f5dc67b2c3735dc539c95213f08393a49ed5127"
      },
      "preview": {
        "path": "templates/starter-v1/orbital-light/preview.png",
        "bytes": 398992,
        "sha256": "8f239185bc7d8e8be4c40305ab1b2574391c6b205a2bec5751e8c3c3d0d0a182"
      }
    }
  },
  {
    "id": "spectral-fold",
    "name": "光谱折面",
    "category": "彩色",
    "modeLabel": "原色字符",
    "motionLabel": "慢流",
    "hoverLabel": "丝绸",
    "suitedTo": "颜色有明显层次、主体清楚的静物、产品图或色彩构图。",
    "adjust": "避免过暗或颜色相近的原图；优先调整曝光，确认色彩后再增加动效。",
    "version": "1.0.0",
    "engineVersion": "2.2.0",
    "assets": {
      "project": {
        "path": "templates/starter-v1/spectral-fold/project.astra",
        "bytes": 768107,
        "sha256": "974b88e36dea981a03aeb2fc87b6ee43cd16175dcce88a4b690806bd1dda30d9"
      },
      "preview": {
        "path": "templates/starter-v1/spectral-fold/preview.png",
        "bytes": 571299,
        "sha256": "0328bfb5cdd1953d8eea63f1fa84a10af55f2c362804f88ac29f8e595402e15b"
      }
    }
  },
  {
    "id": "phrase-echo",
    "name": "字句回响",
    "category": "中文",
    "modeLabel": "中文铺字",
    "motionLabel": "流动",
    "hoverLabel": "涟漪",
    "suitedTo": "轮廓简洁、黑白对比清楚的图形与短句海报；建议先使用2–6个汉字。",
    "adjust": "在“铺底文案”替换短句；降低列数可增大文字，复杂人像需逐张检查效果。",
    "version": "1.0.0",
    "engineVersion": "2.2.0",
    "assets": {
      "project": {
        "path": "templates/starter-v1/phrase-echo/project.astra",
        "bytes": 221971,
        "sha256": "88834f17ae87e6819a8420b2c2f6393fad881ed951c937e7c0cb01d6061d7c63"
      },
      "preview": {
        "path": "templates/starter-v1/phrase-echo/preview.png",
        "bytes": 201336,
        "sha256": "58ee12ef476a4f1c0a208972b109d7828a5b9f22ec14a45d8d09b274c7114dde"
      }
    }
  }
] as const

export type StarterTemplate = (typeof starterTemplates)[number]
