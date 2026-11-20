/** JS mirror of the motion tokens in globals.css (--fx-ease-*, --fx-t-*). */
export const FX_EASE_OUT = [0.16, 1, 0.3, 1] as const
export const FX_EASE_IN_OUT = [0.65, 0, 0.35, 1] as const
export const FX_T = { fast: 0.14, base: 0.24, slow: 0.52, hero: 0.9 } as const
/** Ambient canvas limits (guardrail G3). */
export const FX_MAX_PARTICLES = 60
export const FX_MAX_DPR = 1.5
