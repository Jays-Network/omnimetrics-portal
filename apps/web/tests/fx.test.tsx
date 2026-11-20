import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FX_BOOT_SCRIPT, isLowPower, resolveFx, type FxEnv } from '@/components/fx/fx-core'
import { formatStat, StatCard } from '@/components/fx/stat-card'
import { FX_MAX_PARTICLES } from '@/components/fx/fx-tokens'

const env = (o: Partial<FxEnv> = {}): FxEnv => ({ stored: null, prefersReducedMotion: false, ...o })

describe('resolveFx', () => {
  it('defaults to full', () => expect(resolveFx(env())).toBe('full'))
  it('drops to reduced on low-power devices', () => {
    expect(resolveFx(env({ hardwareConcurrency: 2 }))).toBe('reduced')
    expect(resolveFx(env({ deviceMemory: 4 }))).toBe('reduced')
    expect(resolveFx(env({ hardwareConcurrency: 8, deviceMemory: 8 }))).toBe('full')
    expect(isLowPower({})).toBe(false)
  })
  it('honours a stored choice, even on low-power', () => {
    expect(resolveFx(env({ stored: 'off' }))).toBe('off')
    expect(resolveFx(env({ stored: 'full', hardwareConcurrency: 2 }))).toBe('full')
    expect(resolveFx(env({ stored: 'bogus' }))).toBe('full')
  })
  it('caps full at reduced when the OS asks for reduced motion', () => {
    expect(resolveFx(env({ prefersReducedMotion: true }))).toBe('reduced')
    expect(resolveFx(env({ stored: 'full', prefersReducedMotion: true }))).toBe('reduced')
    expect(resolveFx(env({ stored: 'off', prefersReducedMotion: true }))).toBe('off')
  })
})

describe('FX_BOOT_SCRIPT mirrors resolveFx', () => {
  function run(stored: string | null, cores: number, mem: number | undefined, rm: boolean) {
    document.documentElement.removeAttribute('data-fx')
    vi.stubGlobal('matchMedia', () => ({ matches: rm }))
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(stored)
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(cores)
    Object.defineProperty(navigator, 'deviceMemory', { value: mem, configurable: true })
    new Function(FX_BOOT_SCRIPT)()
    return document.documentElement.getAttribute('data-fx')
  }
  it.each([
    [null, 8, 8, false],
    [null, 2, 8, false],
    [null, 8, 4, false],
    ['off', 8, 8, false],
    ['full', 8, 8, true],
    ['full', 2, 2, false],
  ] as const)('stored=%s cores=%s mem=%s rm=%s', (stored, cores, mem, rm) => {
    expect(run(stored, cores, mem, rm)).toBe(
      resolveFx(env({ stored, hardwareConcurrency: cores, deviceMemory: mem, prefersReducedMotion: rm })),
    )
  })
})

describe('StatCard', () => {
  it('formats with fixed locale and tabular output', () => {
    expect(formatStat(48210)).toBe('48,210')
    expect(formatStat(96.4, 1)).toBe('96.4')
  })
  it('exposes the final value to assistive tech immediately', () => {
    render(<StatCard label="Active vehicles" value={1284} suffix=" units" delta={{ value: -2, label: 'wk' }} />)
    expect(screen.getAllByText('1,284 units').some((el) => el.classList.contains('sr-only'))).toBe(true)
    expect(screen.getByText('-2.0%')).toBeInTheDocument()
  })
})

describe('limits', () => {
  it('caps particles at 60', () => expect(FX_MAX_PARTICLES).toBe(60))
})

describe('/dev/ui', () => {
  it('404s in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { default: Page } = await import('@/app/dev/ui/page')
    expect(() => Page()).toThrowError(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/)
    vi.unstubAllEnvs()
  })
})
