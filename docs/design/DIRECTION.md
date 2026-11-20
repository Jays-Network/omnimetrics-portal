# OmniMetrics design direction

Status: Step 3b. Advisory input: UI UX Pro Max (`--design-system`, "fleet logistics tracking analytics dark data-dense B2B dashboard"). Its output was condensed here; the generated `design-system/` folder was written outside the repo and discarded.

**Precedence:** brand tokens (`apps/web/app/globals.css`) and white-label theming win over everything below. Style: **Data-Dense Dashboard**. Ignored from the skill: the "Enterprise Gateway" landing pattern, its light-blue/amber palette (not from the logo), hero/section patterns, heavy shadows and motion (Phase 5).

## Colours (sampled from `logo-horizontal.png` and `login-bg.webp`)

Logo: cyan `#6EDBF9`, blue `#4DA2ED`, indigo `#5E69D9`/`#707AE1`, purple `#A564E9`, pale `#B2D2FD`. Banner navy: `#0E182E` (dominant), `#202E50`, `#091529` (darkest).

| Token | Value | Use |
|---|---|---|
| `--brand-primary` | `#0e182e` | App background, nav |
| `--brand-surface` | `#15213b` | Cards, panels |
| `--brand-surface-raised` | `#202e50` | Popovers, row hover, table header |
| `--brand-border` | `#364970` | Decorative edges (not for form controls) |
| `--brand-border-strong` | `#5f73a8` | Input edges, 3.4:1+ on surfaces |
| `--brand-text` | `#eef3fc` | Primary text |
| `--brand-text-muted` | `#a1bfe3` | Labels, secondary |
| `--brand-accent` / `-fg` | `#6edbf9` / `#0e182e` | Buttons, focus ring, active nav |
| `--brand-danger` / `-fg` | `#f87171` / `#0e182e` | Errors, overdue. Not in the logo; functional colour |

Contrast (WCAG): text on primary 15.9:1, on surface 14.4:1; muted on surface 8.4:1, on raised 7.1:1; accent-fg on accent 11.1:1; danger on surface 5.8:1; input border on surface 3.4:1. Body text must stay >= 4.5:1, large text and UI edges >= 3:1. Verify any new pair before use.

Status colours for tables and stat cards (when needed) are functional, not brand: danger as above; add warning/success tokens in Step 4 only if a panel needs them, and never rely on colour alone (pair with icon or label).

## Chart colours

Series order: `--chart-1` cyan `#6edbf9`, `--chart-2` purple `#a564e9`, `--chart-3` blue `#4da2ed`, `--chart-4` indigo `#707ae1`, `--chart-5` pale `#b2d2fd`. All >= 4.2:1 on surface. Max 5 series; beyond that, group into "Other" or use a table. Single-series charts use `--chart-1`. Blue/indigo/pale are close in hue, so label series directly or in the legend and avoid placing them adjacent in stacked bars when a purple or cyan can sit between them. Gridlines `--brand-border`, axis text `--brand-text-muted` at 12px, tabular numerals. Wire shadcn `ChartConfig` to these variables (`var(--chart-n)`), never hex.

## Type

Keep the existing `next/font` pair: **DM Sans** (UI, tables, numbers) and **Syne** (`font-display`, page and card titles only). No new font dependency. Sizes: 12px table and axis text, 13-14px body/controls, 16px section titles, 20-24px page titles, stat values 28-32px. Use `.tabular` (tabular-nums) on every number column and stat value. IDs and registrations may use `ui-monospace`.

## Spacing and shape

- 4px grid. Card padding 12-16px (dense), gap between cards 12px, table row height 32-36px, control height 36px (login uses 40px).
- Radii derive from `--brand-radius` (6px): `rounded-sm` 4, `md` 6, `lg` 8, `xl` 10. Changing the one token re-shapes the whole UI.
- Borders over shadows: 1px `--brand-border`; shadow only on popovers.
- Focus: 2px `--brand-accent` ring with 2px offset in `--brand-primary`. Never remove it.

## Light / dark rules

- Dark is the only shipped theme (`<html class="dark">`, `color-scheme: dark`, theme-color `#0e182e`). The logo is made for dark backgrounds; a light theme needs a dark-ink logo variant first.
- When light is added: override only the `--brand-*` and `--chart-*` tokens under a `.light` scope; keep hues, raise darkness of accent (cyan `#6edbf9` fails on white, use `#0e7490`-range with white fg), re-check every contrast pair above. Components must not change.
- White-label: a client rebrand changes the `:root` block, `public/brand/*` and `NEXT_PUBLIC_BRAND_NAME`. `NEXT_PUBLIC_BRAND_COLOR` overrides `--brand-accent` only; if the new accent is dark, `--brand-accent-fg` must be overridden too.

## Motion

None beyond colour transitions and the sign-in spinner. All motion respects `prefers-reduced-motion` (spinner uses `motion-reduce:animate-none`). Anything richer is Phase 5.

## Assets

`apps/web/app/`: `icon.png` (256), `apple-icon.png` (180), `favicon.ico` (Next file conventions). `apps/web/public/brand/`: `logo-horizontal.png` (dark backgrounds only), `emblem-1024.png`, `login-bg.webp` (login only, 25% opacity under a 75% navy overlay), `icon-192.png`, `favicon-16/32.png` (unused until a web manifest exists).
