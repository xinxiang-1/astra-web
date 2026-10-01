export const starterRecipes = [
  {
    id: 'orbital-light',
    name: '星环余光',
    mode: 'density',
    modeLabel: '光影字符',
    quality: 'faithful',
    columns: 150,
    background: '#111615',
    ink: '#dbe9d8',
    invert: false,
    motion: 'breathe',
    motionLabel: '光息',
    hover: 'light',
    hoverLabel: '光晕',
    motionSpeed: 0.5,
    motionStrength: 0.35,
    hoverStrength: 0.75,
    hoverRadius: 0.38,
    suitedTo: '明暗层次清楚、背景简洁的静物或几何构图；主体周围保留空间。',
    adjust: '先替换自己的照片，再调曝光和对比度；细节过密时降低列数。',
  },
  {
    id: 'spectral-fold',
    name: '光谱折面',
    mode: 'color',
    modeLabel: '原色字符',
    quality: 'faithful',
    columns: 150,
    background: '#111615',
    ink: '#f5f3ef',
    invert: false,
    motion: 'current',
    motionLabel: '慢流',
    hover: 'silk',
    hoverLabel: '丝绸',
    motionSpeed: 0.4,
    motionStrength: 0.35,
    hoverStrength: 0.65,
    hoverRadius: 0.38,
    suitedTo: '颜色有明显层次、主体清楚的静物、产品图或色彩构图。',
    adjust: '避免过暗或颜色相近的原图；优先调整曝光，确认色彩后再增加动效。',
  },
  {
    id: 'phrase-echo',
    name: '字句回响',
    mode: 'phrase',
    modeLabel: '中文铺字',
    quality: 'classic',
    columns: 76,
    background: '#f5f3ef',
    ink: '#172d26',
    invert: true,
    phrase: '星河回响',
    motion: 'wave',
    motionLabel: '流动',
    hover: 'ripple',
    hoverLabel: '涟漪',
    motionSpeed: 0.4,
    motionStrength: 0.3,
    hoverStrength: 0.65,
    hoverRadius: 0.38,
    suitedTo: '轮廓简洁、黑白对比清楚的图形与短句海报；建议先使用2–6个汉字。',
    adjust: '在“铺底文案”替换短句；降低列数可增大文字，复杂人像需逐张检查效果。',
  },
]

/** Original geometric sources: no fonts, external images or randomness. Serializable into the offline tool. */
export function drawStarterSource(context, id, width = 800, height = 1000) {
  const c = context
  c.save()
  c.scale(width / 800, height / 1000)
  c.fillStyle = '#07120f'
  c.fillRect(0, 0, 800, 1000)
  function ellipse(x, y, rx, ry, angle, style, line = 0) {
    c.beginPath()
    c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2)
    if (line) {
      c.lineWidth = line
      c.strokeStyle = style
      c.stroke()
    } else {
      c.fillStyle = style
      c.fill()
    }
  }
  if (id === 'orbital-light') {
    const haze = c.createRadialGradient(385, 450, 20, 400, 490, 460)
    haze.addColorStop(0, '#46635a')
    haze.addColorStop(0.55, '#152a22')
    haze.addColorStop(1, '#07120f')
    c.fillStyle = haze
    c.fillRect(0, 0, 800, 1000)
    const glow = c.createRadialGradient(318, 390, 8, 410, 485, 220)
    glow.addColorStop(0, '#f4f5e9')
    glow.addColorStop(0.36, '#cbdac8')
    glow.addColorStop(0.7, '#637d70')
    glow.addColorStop(1, '#172a21')
    ellipse(400, 485, 190, 190, 0, glow)
    const rim = c.createLinearGradient(90, 380, 720, 610)
    rim.addColorStop(0, '#3b5849')
    rim.addColorStop(0.4, '#eaf0df')
    rim.addColorStop(1, '#698b7a')
    ellipse(400, 490, 314, 91, -0.37, rim, 14)
    ellipse(400, 490, 338, 112, -0.37, '#799585', 2)
    ellipse(400, 490, 360, 129, -0.37, '#284539', 1)
    c.fillStyle = '#b8cec0'
    for (const [x, y, r] of [
      [172, 274, 2],
      [604, 218, 3],
      [675, 706, 2],
      [205, 790, 2],
      [500, 766, 1],
    ])
      ellipse(x, y, r, r, 0, c.fillStyle)
  } else if (id === 'spectral-fold') {
    const wash = c.createLinearGradient(0, 0, 800, 1000)
    wash.addColorStop(0, '#102728')
    wash.addColorStop(1, '#070f13')
    c.fillStyle = wash
    c.fillRect(0, 0, 800, 1000)
    const panels = [
      [
        [154, 555],
        [353, 188],
        [555, 532],
        ['#c7ebd4', '#4ba1a2', '#15292d'],
      ],
      [
        [154, 555],
        [555, 532],
        [314, 830],
        ['#2bb7bb', '#194b67', '#091720'],
      ],
      [
        [353, 188],
        [677, 421],
        [555, 532],
        ['#eee7c2', '#c78f72', '#375966'],
      ],
      [
        [555, 532],
        [677, 421],
        [632, 731],
        ['#edb894', '#764d65', '#0d2631'],
      ],
      [
        [314, 830],
        [555, 532],
        [632, 731],
        ['#315b8d', '#75bec1', '#0e2738'],
      ],
    ]
    for (const [a, b, d, colors] of panels) {
      const fill = c.createLinearGradient(a[0], a[1], d[0], d[1])
      fill.addColorStop(0, colors[0])
      fill.addColorStop(0.5, colors[1])
      fill.addColorStop(1, colors[2])
      c.beginPath()
      c.moveTo(...a)
      c.lineTo(...b)
      c.lineTo(...d)
      c.closePath()
      c.fillStyle = fill
      c.fill()
      c.strokeStyle = '#bdeae766'
      c.lineWidth = 1.5
      c.stroke()
    }
    ellipse(412, 890, 244, 22, 0, '#173739')
    ellipse(411, 480, 310, 390, -0.1, '#386364', 1)
  } else if (id === 'phrase-echo') {
    c.fillStyle = '#f5f3ef'
    c.fillRect(0, 0, 800, 1000)
    const ink = c.createLinearGradient(195, 250, 600, 800)
    ink.addColorStop(0, '#102820')
    ink.addColorStop(0.55, '#305444')
    ink.addColorStop(1, '#8da692')
    ellipse(400, 480, 243, 285, -0.12, ink)
    c.globalCompositeOperation = 'destination-out'
    ellipse(455, 407, 205, 250, -0.12, '#000')
    c.globalCompositeOperation = 'source-over'
    // Refill the cleared crescent with paper so the source is an opaque illustration.
    c.globalCompositeOperation = 'destination-over'
    c.fillStyle = '#f5f3ef'
    c.fillRect(0, 0, 800, 1000)
    c.globalCompositeOperation = 'source-over'
    ellipse(590, 696, 52, 52, 0, '#354f40')
    ellipse(211, 827, 6, 6, 0, '#59725c')
    for (let i = 0; i < 3; i++) ellipse(382, 486, 290 + i * 20, 340 + i * 20, -0.12, '#a4b5a5', 2)
  } else {
    c.restore()
    throw new Error(`Unknown original source: ${id}`)
  }
  c.restore()
}
