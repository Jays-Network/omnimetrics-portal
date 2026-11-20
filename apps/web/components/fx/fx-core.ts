/**
 * Effects level core: pure resolution logic + the pre-paint boot script.
 * The same rules live in FX_BOOT_SCRIPT (inline, runs before first paint so
 * there is no flash of the wrong level). tests/fx.test.ts keeps them in step.
 */
export type FxLevel = 'full' | 'reduced' | 'off'
export const FX_STORAGE_KEY = 'omni-fx'
export const FX_LEVELS: readonly FxLevel[] = ['full', 'reduced', 'off']

export function isFxLevel(v: unknown): v is FxLevel {
  return v === 'full' || v === 'reduced' || v === 'off'
}

export interface FxEnv {
  stored: string | null
  hardwareConcurrency?: number
  deviceMemory?: number
  prefersReducedMotion: boolean
}

/** Low-power heuristic: <= 2 cores or <= 4 GB (deviceMemory is Chromium-only). */
export function isLowPower(env: Pick<FxEnv, 'hardwareConcurrency' | 'deviceMemory'>): boolean {
  return (
    (env.hardwareConcurrency != null && env.hardwareConcurrency <= 2) ||
    (env.deviceMemory != null && env.deviceMemory <= 4)
  )
}

/**
 * Stored choice wins; otherwise full, dropped to reduced on low-power devices.
 * prefers-reduced-motion always caps "full" at "reduced" (CSS also zeroes motion).
 */
export function resolveFx(env: FxEnv): FxLevel {
  let level: FxLevel = isFxLevel(env.stored) ? env.stored : isLowPower(env) ? 'reduced' : 'full'
  if (env.prefersReducedMotion && level === 'full') level = 'reduced'
  return level
}

export const FX_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=null,n=navigator;try{s=localStorage.getItem('${FX_STORAGE_KEY}')}catch(e){}var l=(s==='full'||s==='reduced'||s==='off')?s:(((n.hardwareConcurrency&&n.hardwareConcurrency<=2)||(n.deviceMemory&&n.deviceMemory<=4))?'reduced':'full');if(l==='full'&&matchMedia('(prefers-reduced-motion: reduce)').matches)l='reduced';d.setAttribute('data-fx',l);document.addEventListener('visibilitychange',function(){if(document.hidden)d.setAttribute('data-hidden','');else d.removeAttribute('data-hidden')})}catch(e){}})();`

/** Read the current environment (client only). */
export function readFxEnv(): FxEnv {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(FX_STORAGE_KEY)
  } catch {
    /* private mode / blocked storage */
  }
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    stored,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

/** Persist a choice and apply it to <html> (components follow via the observer). */
export function setFxLevel(level: FxLevel): void {
  try {
    localStorage.setItem(FX_STORAGE_KEY, level)
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-fx', resolveFx({ ...readFxEnv(), stored: level }))
}
