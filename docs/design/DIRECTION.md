# OmniMetrics design direction: Holographic HUD

Status: design pass 2 (2026-11-20), global. Supersedes the "Data-Dense Dashboard, no heavy motion" direction of Step 3b. Advisory input: UI UX Pro Max (`glassmorphism`, `HUD / Sci-Fi FUI`, motion UX rules), condensed below; its neon colours (`#00FFFF`, `#0080FF`, `#FF0000`) and monospace/black HUD palette were NOT adopted. Palette stays sampled from the logo.

**Precedence:** brand tokens (`apps/web/app/globals.css`) and white-label theming win over everything below. Jay's direction: modern, over-the-top "system from the future": holographic, glowing, lots of motion, applied to the whole system. Style only is borrowed from the mood reference (glassmorphism login, cyan/blue waves, neon pill button); artwork is ours.

## Principles

1. **Data beats decoration (G1).** Charts, tables and stat values sit on *data glass* (93-100% opaque, never blurred). Effects live in backgrounds, borders, glows, hover and transitions, never behind a number.
2. **One switch (G2).** Every effect reads the effects level. No component special-cases itself.
3. **Cheap by construction (G3).** Animate `transform` and `opacity` only. `filter`/`box-shadow` only on small elements (button glow, brackets) or static. Few, non-nested `backdrop-filter` surfaces.
4. **Accessible (G5).** AA text, focus rings always visible, nothing flashes > 3/s, keyboard flow unchanged.

## Colours (unchanged: sampled from `logo-horizontal.png` and `login-bg.webp`)

Logo: cyan `#6EDBF9`, blue `#4DA2ED`, indigo `#707AE1`, purple `#A564E9`, pale `#B2D2FD`. Navy: `#0E182E`, `#15213B`, `#202E50`.

| Token | Value | Use |
|---|---|---|
| `--brand-primary` | `#0e182e` | App background |
| `--brand-surface` / `-raised` | `#15213b` / `#202e50` | Panels / popovers, headers |
| `--brand-border` / `-strong` | `#364970` / `#5f73a8` | Decorative edges / form edges (3.4:1) |
| `--brand-text` / `-muted` | `#eef3fc` / `#a1bfe3` | Text (15.9:1 / 8.4:1 on surface) |
| `--brand-accent` / `-fg` | `#6edbf9` / `#0e182e` | CTAs, focus ring, active nav |
| `--brand-danger` | `#f87171` | Errors, negative trend (5.8:1) |
| `--chart-1..5` | cyan, purple, blue, indigo, pale | Series order, max 5, `var(--chart-n)` never hex |

Glow colours are aliases of the brand/chart tokens, so a rebrand re-points three variables: `--glow-1` (= accent, cyan), `--glow-2` (= `--chart-3`, blue), `--glow-3` (= `--chart-2`, purple).

Verified pairs added in this pass: navy on the neon gradient end (`#4da2ed`) 6.5:1, navy on cyan 11.1:1. Gradient text: purple end 4.7:1 on navy, 4.3:1 on surface, so large display text only (>= 24px).

## Effects levels (G2)

`<html data-fx="full|reduced|off">`, set before first paint by an inline script (`components/fx/fx-core.ts`). Any subtree may carry its own `data-fx` (used by `/dev/ui`); because levels are CSS variables, the nearest ancestor wins.

Resolution: stored choice (`localStorage` key `omni-fx`) wins; else `full`, dropped to `reduced` when `navigator.hardwareConcurrency <= 2` or `deviceMemory <= 4` (Chromium only). `prefers-reduced-motion: reduce` caps `full` at `reduced` and zeroes motion in every level and scope. The shell toggle (three icons in the topbar) writes the choice; "Full" is disabled while the OS asks for reduced motion.

| Variable | full | reduced | off |
|---|---|---|---|
| `--fx-motion` (transitions, entrances) | 1 | 0 | 0 |
| `--fx-play` (ambient loops) | running | paused | paused |
| `--fx-glow` (glow strength) | 1 | 0.5 | 0 |
| `--fx-ambient` (aurora, grid, banner) | 1 | 0.6 | 0 |
| `--fx-backdrop` | blur 14px + saturate | none | none |
| `--fx-edge` (gradient border) | 1 | 0.7 | 0 (solid border) |
| glass alpha 1 / 2 / 3 / data | 38 / 62 / 78 / 93% | 70 / 86 / 92 / 96% | 100% |
| Canvas particles, scanline | on | not mounted | not mounted |
| Banner image | on | static, dimmer | not rendered |

Always on, every level: HUD brackets, 2px accent focus ring, form-edge contrast, tabular numerals.

## Tokens (all in `globals.css`)

- Glass: `--glass-1/2/3/data` (derived from `--brand-surface` and the level alphas). Blur steps `--fx-blur-1/2/3` = 8/14/22px.
- Glow: `--glow-N`, `--glow-N-soft|mid|strong` (22/45/75% x `--fx-glow`). Border: `--fx-border-gradient` (cyan to purple, 135deg). Button: `--fx-neon-gradient` (cyan to blue). Text: `--fx-text-gradient`.
- Level hooks: `--fx-motion`, `--fx-play`, `--fx-glow`, `--fx-ambient`, `--fx-backdrop`, `--fx-edge`, `--fx-glass-a*`.

## Motion

| Token | Value | Use |
|---|---|---|
| `--fx-t-fast` | 140ms | press, hover colour, input focus |
| `--fx-t-base` | 240ms | panel halo, spotlight fade |
| `--fx-t-slow` | 520ms | entrances, route enter, nav indicator slide |
| `--fx-t-hero` | 900ms | hero sequences, count-up (900ms) |
| `--fx-t-ambient` | 18s | aurora cycle (x1.3, x1.7 per blob) |
| `--fx-stagger` | 80ms | per index (`--i`) |
| `--fx-ease-out` | `cubic-bezier(.16,1,.3,1)` | entrances, sweeps |
| `--fx-ease-in-out` | `cubic-bezier(.65,0,.35,1)` | loops, exits |
| `--fx-ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | press, nav indicator |

Time tokens collapse to 0 at `reduced`/`off`, so one rule serves all levels (`--d-fast|base|slow|hero|stagger`). JS mirror: `components/fx/fx-tokens.ts`. Ambient loops: grid 6s, scanline 11s, button glow 3.2s, shine 5.5s (one pass), halo 5s, orbit 26s/40s. None is faster than 0.5 Hz.

Framer Motion v12 (`domAnimation` via `LazyMotion`, `m.*` only) is used for route transitions (`PageTransition`). It is mounted by the dashboard layout and `/dev/ui`, not on `/login`. Prefer CSS keyframes for anything that does not need JS.

## Primitives (`apps/web/components/fx/`)

`HoloBackground` (aurora, grid, scanline, <= 60 particles, DPR <= 1.5, masked banner, vignette) · `GlassPanel` (tones 1/2/3/data, gradient border, inner glow, brackets, throttled spotlight, hover sheen, halo) · `NeonButton` · `GlowInput` · `StatCard` (count-up) · `Skeleton` · `PageTransition` · `GradientText` · `FxToggle` · `FxScope` / `useFxLevel` · `MotionRoot`. Review all of them at all levels at `/dev/ui` (development only, 404 in production).

Banner: `public/brand/login-bg.webp` at ~62% with the centre ghost logo and bottom wordmark masked out (only the outer 19% bands of the artwork remain), sized from the container so the mask tracks the art at any viewport.

## Do / don't

Do: put data on `data` tone. Use `GlassPanel` for chrome and cards, `NeonButton` for the one primary action per view, `GradientText` for at most one headline per screen. Use tokens, never hex. Keep content in `relative z-10` above `HoloBackground`. Pair trend colour with an arrow and sign.

Don't: nest `backdrop-filter` surfaces or put it on large scrolling areas. Animate `width`/`height`/`top`/`left`/`background-position`. Blur or tint behind chart plots and table cells. Add a second canvas or exceed 60 particles. Use gradient text below 24px. Add a flashing element. Hide focus. Write a per-level `if` in a component (read a variable instead).

## Type, spacing, shape (unchanged)

DM Sans for UI and numbers (`.tabular`), Syne (`font-display`) for page and card titles. 4px grid, radii from `--brand-radius`. Cards 12-16px padding, 12px gaps, tables 32-36px rows. Dense, legible, consistent: the HUD style is the skin, not licence for sparse layouts.

## Light theme

Dark is the only shipped theme. Glow and glass tokens derive from `--brand-*`, so a future `.light` scope overrides tokens only; glow intensity should drop sharply on light.

## Assets

`apps/web/app/`: `icon.png`, `apple-icon.png`, `favicon.ico`. `apps/web/public/brand/`: `logo-horizontal.png`, `emblem-1024.png` (login hero, sidebar), `login-bg.webp` (hero banner), `icon-192.png`, `favicon-16/32.png`. White-label: change the `:root` block, swap `public/brand/*`, set `NEXT_PUBLIC_BRAND_NAME`; `NEXT_PUBLIC_BRAND_COLOR` overrides `--brand-accent` (and therefore `--glow-1`).
