export interface DiskLook {
  brightness: number;
  speed: number;
  stretch: number;
  detail: number;
  turbulence: number;
  density: number;
  doppler: number;
  cloudScale: number;
  cloudSpeed: number;
  cloudStrength: number;
  spare0: number;
  spare1: number;
  spare2: number;
  spare3: number;
}

export interface StarLook {
  brightness: number;
  density: number;
  contrast: number;
  warmth: number;
  twinkle: number;
}

export interface BloomLook {
  strength: number;
  threshold: number;
  knee: number;
  radius: number;
}

export interface InteractionLook {
  /** Max camera yaw from pointer X, in radians-ish scene units. */
  mouseYaw: number;
  /** Exponential smoothing time for yaw follow (seconds). */
  yawSmoothing: number;
  /** How strongly pointer X scales disk spin (0 = ignore position). */
  speedFromPointerX: number;
  /** How strongly pointer velocity boosts/slows disk spin. */
  speedFromVelocity: number;
  /** Exponential decay time for smoothed pointer velocity (seconds). */
  velocityDecay: number;
}

export interface HeroSettings {
  cameraY: number;
  distance: number;
  diskRadius: number;
  fov: number;
  centerX: number;
  centerY: number;
  cameraRoll: number;
  mouseYaw: number;
  centerFade: number;
  interaction: InteractionLook;
  bloom: BloomLook;
  disk: DiskLook;
  stars: StarLook;
}

/** Shared deterministic production defaults for the browser and headless renderer. */
export function defaultHeroSettings(): HeroSettings {
  return {
    cameraY: 0.16,
    distance: 13.5,
    diskRadius: 9,
    fov: 3,
    centerX: 0.8,
    centerY: 0.3,
    cameraRoll: -0.27,
    mouseYaw: 0.42,
    centerFade: 0,
    interaction: {
      mouseYaw: 0.42,
      yawSmoothing: 0.18,
      speedFromPointerX: 0.4,
      speedFromVelocity: 0.28,
      velocityDecay: 0.28,
    },
    bloom: { strength: 1, threshold: 0, knee: 0.18, radius: 1.5 },
    disk: {
      brightness: 0.75,
      speed: 0.75,
      stretch: 5.75,
      detail: 3.44,
      turbulence: 4.46,
      density: 1.38,
      doppler: 1.21,
      cloudScale: 20,
      cloudSpeed: 0.3,
      cloudStrength: 0.2,
      spare0: 0.43,
      spare1: -0.25,
      spare2: -0.67,
      spare3: 0.69,
    },
    stars: { brightness: 1, density: 1, contrast: 13, warmth: 0.5, twinkle: 0 },
  };
}
