// Browser lifecycle for the baked black-hole pipeline. VGPU stays dynamically imported.

import type { Frame, Gpu, Surface } from "vgpu";

type VgpuApi = typeof import("vgpu");

import {
  createEffects,
  createTargets,
  destroyTargets,
  prewarm,
  renderChain,
  setBakeUniforms,
  setBindings,
  setPostUniforms,
  setShadeUniforms,
  type Effects,
  type Targets,
} from "./pipeline";
import {
  defaultHeroSettings,
  type HeroSettings,
  type InteractionLook,
} from "./settings";

const MAX_FRAME_DT_S = 0.1;

const TARGET_FPS = 60;

const FRAME_PACING_EPSILON_MS = 2;

const MIN_FRAME_INTERVAL_MS = 1000 / TARGET_FPS - FRAME_PACING_EPSILON_MS;
const MOBILE_QUERY = "(max-width: 767px)";

export interface BlackHoleRendererOptions {
  canvas: HTMLCanvasElement;
  /** Override camera / disk interaction tuning. */
  interaction?: Partial<InteractionLook>;
  /** Base accretion-disk spin; pointer modulates around this. */
  baseDiskSpeed?: number;
}

type RenderSize = { width: number; height: number };

export function createRenderer({
  canvas,
  interaction: interactionOverrides,
  baseDiskSpeed,
}: BlackHoleRendererOptions) {
  const settings = defaultHeroSettings();
  if (interactionOverrides) {
    Object.assign(settings.interaction, interactionOverrides);
    if (interactionOverrides.mouseYaw !== undefined) {
      settings.mouseYaw = interactionOverrides.mouseYaw;
    }
  }
  if (baseDiskSpeed !== undefined) {
    settings.disk.speed = baseDiskSpeed;
  }
  const baseSpeed = settings.disk.speed;
  const desktopLayout = {
    centerX: settings.centerX,
    centerY: settings.centerY,
    cameraRoll: settings.cameraRoll,
    mouseYaw: settings.mouseYaw,
    centerFade: settings.centerFade,
    interaction: { ...settings.interaction },
  };
  const mobileQuery = window.matchMedia(MOBILE_QUERY);
  const applyResponsiveLayout = () => {
    if (mobileQuery.matches) {
      Object.assign(settings, {
        centerX: 0,
        centerY: 0,
        cameraRoll: 0,
        centerFade: 1,
        // Keep yaw interactive on touch; slightly softer than desktop.
        mouseYaw: desktopLayout.mouseYaw * 0.85,
        interaction: {
          ...desktopLayout.interaction,
          mouseYaw: desktopLayout.interaction.mouseYaw * 0.85,
          yawSmoothing: Math.max(0.12, desktopLayout.interaction.yawSmoothing),
        },
      });
    } else {
      Object.assign(settings, {
        centerX: desktopLayout.centerX,
        centerY: desktopLayout.centerY,
        cameraRoll: desktopLayout.cameraRoll,
        mouseYaw: desktopLayout.mouseYaw,
        centerFade: desktopLayout.centerFade,
        interaction: { ...desktopLayout.interaction },
      });
    }
  };
  applyResponsiveLayout();
  const bloomScale = Math.min(Math.max(window.devicePixelRatio, 1), 2) / 2;
  settings.bloom.radius *= bloomScale;
  settings.bloom.strength *= bloomScale;

  let disposed = false;

  let api: VgpuApi | undefined;
  let gpu: Gpu | undefined;
  let surface: Surface | undefined;
  let effects: Effects | undefined;
  let targets: Targets | undefined;
  let loop: { stop(): void } | undefined;
  let observer: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let documentVisible =
    typeof document === "undefined" ? true : !document.hidden;
  let canvasIntersecting = true;

  let started = false;
  let animationTime = 0;
  /** Integrated disk clock — advances at variable rate so spin stays continuous. */
  let diskTime = 0;
  let lastFrameAt: number | undefined;
  let resizeFrame = 0;
  let pendingSize: RenderSize | undefined;
  let forceBake = true;

  /** Pointer X/Y in [-1, 1] relative to the canvas. */
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let lastPointerSampleAt: number | undefined;
  let lastPointerX = 0;
  let smoothedVelocityX = 0;
  let smoothedSpeedScale = 1;
  let currentSceneYaw = 0;
  let lastInteractAt: number | undefined;

  const onLayoutChange = () => {
    applyResponsiveLayout();
    forceBake = true;
  };
  mobileQuery.addEventListener("change", onLayoutChange);

  const samplePointer = (clientX: number, clientY: number, now: number) => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    const nextX = Math.min(
      1,
      Math.max(-1, ((clientX - rect.left) / width) * 2 - 1)
    );
    const nextY = Math.min(
      1,
      Math.max(-1, ((clientY - rect.top) / height) * 2 - 1)
    );

    if (lastPointerSampleAt !== undefined) {
      const dt = Math.min(
        Math.max((now - lastPointerSampleAt) / 1000, 1 / 240),
        MAX_FRAME_DT_S
      );
      const rawVelocity = (nextX - lastPointerX) / dt;
      // Soft-clamp flicks; keep updates gentle so spin does not stutter.
      const clamped = Math.max(-3, Math.min(3, rawVelocity));
      smoothedVelocityX += (clamped - smoothedVelocityX) * 0.22;
    }

    lastPointerX = nextX;
    lastPointerSampleAt = now;
    pointerX = nextX;
    pointerY = nextY;
    pointerActive = true;
  };

  const onPointerMove = (event: PointerEvent) => {
    samplePointer(event.clientX, event.clientY, clockMs());
  };

  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture?.(event.pointerId);
    samplePointer(event.clientX, event.clientY, clockMs());
  };

  const onPointerUp = (event: PointerEvent) => {
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  };

  const recenterPointer = () => {
    pointerX = 0;
    pointerY = 0;
    pointerActive = false;
    lastPointerSampleAt = undefined;
    // Keep a little residual velocity so the disk eases out instead of stopping.
  };
  const onPointerLeave = () => {
    recenterPointer();
  };
  const onVisibilityChange = () => {
    if (document.hidden) recenterPointer();
    documentVisible = !document.hidden;
    reconcileLoop();
  };

  function reconcileLoop(): void {
    if (!started || !gpu || !api) return;
    const shouldRun = !disposed && documentVisible && canvasIntersecting;
    if (shouldRun === Boolean(loop)) return;
    if (shouldRun) {
      lastFrameAt = undefined;
      lastInteractAt = undefined;
      loop = startPacedLoop(api, gpu);
    } else {
      loop?.stop();
      loop = undefined;
    }
  }

  function startPacedLoop(vgpu: VgpuApi, activeGpu: Gpu): { stop(): void } {
    let stopped = false;

    let lastPresentedAt: number | undefined;
    const tick = (timestamp: number): void => {
      if (stopped) return;
      if (
        lastPresentedAt === undefined ||
        timestamp - lastPresentedAt >= MIN_FRAME_INTERVAL_MS
      ) {
        lastPresentedAt = timestamp;
        try {
          vgpu.frame(activeGpu, renderFrame);
        } catch (error) {
          handleFailure(error);
        }
      }
      if (!stopped) frameHandle = requestAnimationFrame(tick);
    };
    let frameHandle = requestAnimationFrame(tick);
    return {
      stop(): void {
        stopped = true;
        cancelAnimationFrame(frameHandle);
      },
    };
  }

  const advanceAnimationTime = (now: number): number => {
    animationTime +=
      lastFrameAt === undefined ? 0 : Math.max(0, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    return animationTime;
  };

  const renderFrame = (frame: Frame): void => {
    if (disposed || !effects || !targets || !surface) return;
    const now = clockMs();
    const runBake = forceBake;
    forceBake = false;
    if (runBake) setBakeUniforms(effects, targets, settings);
    const yaw = advanceInteraction(now);
    // Wall-clock for bookkeeping; disk uses integrated diskTime (no speed jumps).
    advanceAnimationTime(now);
    setShadeUniforms(effects, targets, settings, diskTime, yaw);
    renderChain(frame, effects, targets, surface, runBake);
  };

  const advanceInteraction = (now: number): number => {
    const interaction = settings.interaction;
    const yawAmount = Math.max(0, interaction.mouseYaw || settings.mouseYaw);
    const dt =
      lastInteractAt === undefined
        ? 0
        : Math.min(Math.max((now - lastInteractAt) / 1000, 0), MAX_FRAME_DT_S);
    lastInteractAt = now;

    if (dt > 0) {
      const decay =
        1 - Math.exp(-dt / Math.max(0.08, interaction.velocityDecay));
      if (!pointerActive) {
        smoothedVelocityX += (0 - smoothedVelocityX) * decay;
      } else {
        smoothedVelocityX *= 1 - decay * 0.25;
      }
    }

    const targetYaw = pointerX * yawAmount;
    const yawTau = Math.max(0.06, interaction.yawSmoothing);
    if (yawAmount <= 0) {
      currentSceneYaw = 0;
    } else {
      currentSceneYaw +=
        (targetYaw - currentSceneYaw) * (1 - Math.exp(-dt / yawTau));
    }

    // Target spin rate from pointer — then smooth it, then integrate into diskTime.
    // Never mutate disk.speed: shade uses time*speed, so changing speed jumps the phase.
    const fromX = pointerX * interaction.speedFromPointerX;
    const fromVelocity = smoothedVelocityX * interaction.speedFromVelocity;
    const fromY = pointerActive ? -pointerY * 0.08 : 0;
    const targetScale = Math.max(
      0.45,
      Math.min(1.75, 1 + fromX + fromVelocity + fromY)
    );
    const scaleTau = 0.22;
    if (dt > 0) {
      smoothedSpeedScale +=
        (targetScale - smoothedSpeedScale) *
        (1 - Math.exp(-dt / scaleTau));
      diskTime += dt * smoothedSpeedScale;
    }

    settings.disk.speed = baseSpeed;
    return currentSceneYaw;
  };

  const applyResize = () => {
    resizeFrame = 0;
    const size = pendingSize;
    pendingSize = undefined;
    if (disposed || !size || !gpu || !api || !effects || !targets || !surface)
      return;
    try {
      const previousTargets = targets;
      const nextTargets = createTargets(api, gpu, [
        Math.max(1, Math.round(size.width)),
        Math.max(1, Math.round(size.height)),
      ]);
      try {
        setBindings(effects, nextTargets);
        setPostUniforms(effects, nextTargets, settings);
      } catch (error) {
        destroyTargets(nextTargets);
        throw error;
      }
      targets = nextTargets;
      destroyTargets(previousTargets);
      forceBake = true;
    } catch (error) {
      handleFailure(error);
    }
  };
  const resize = (size: RenderSize) => {
    if (disposed || size.width <= 0 || size.height <= 0) return;
    pendingSize = size;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
  };

  const measure = () => {
    resize({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    loop?.stop();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    observer?.disconnect();
    intersection?.disconnect();
    if (typeof window !== "undefined") {
      mobileQuery.removeEventListener("change", onLayoutChange);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", recenterPointer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    gpu?.dispose();
  };

  const initialize = async () => {
    const vgpu = await import("vgpu");
    const { init } = vgpu;
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    api = vgpu;
    surface = vgpu.surface(gpu, canvas, { dpr: 1 });
    effects = createEffects(vgpu, gpu);
    targets = createTargets(vgpu, gpu, surface.size);
    setBindings(effects, targets);
    setPostUniforms(effects, targets, settings);
    await prewarm(effects, targets, surface);
    if (disposed) return;
    observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(canvas);
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
    canvas.addEventListener("pointerup", onPointerUp, { passive: true });
    canvas.addEventListener("pointercancel", onPointerUp, { passive: true });
    canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("blur", recenterPointer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver(
        (entries) => {
          canvasIntersecting =
            entries[entries.length - 1]?.isIntersecting ?? canvasIntersecting;
          reconcileLoop();
        },
        { threshold: 0 }
      );
      intersection.observe(canvas);
    }
    measure();
    started = true;
    documentVisible = !document.hidden;
    reconcileLoop();
  };

  function handleFailure(error: unknown): never {
    dispose();
    throw error;
  }

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    handleFailure(error);
  });

  return { ready, dispose };
}

function clockMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export type { HeroSettings, InteractionLook };
