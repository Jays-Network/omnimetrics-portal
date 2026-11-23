import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { AssetBar } from '@/components/builder/asset-bar'
import { PANEL_TYPES } from '@/lib/panels/registry'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const bar = (onAdd = vi.fn()) => render(<DndContext><AssetBar selectedId={null} onSelect={() => {}} onAdd={onAdd} /></DndContext>)

describe('AssetBar', () => {
  it('lists every asset in the registry, in every category', () => {
    bar()
    expect(screen.getByText(`${PANEL_TYPES.length} of ${PANEL_TYPES.length} assets`)).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(8) // categories, as an accordion
  })
  it('opens one category at a time and remembers it', () => {
    localStorage.clear()
    bar()
    const charts = screen.getByRole('button', { name: /^Charts/ })
    const single = screen.getByRole('button', { name: /^Single value/ })
    expect(charts).toHaveAttribute('aria-expanded', 'true')
    expect(single).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(single)
    expect(screen.getByRole('button', { name: /^Charts/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Single value/ })).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('omni-assets-open')).toBe('single')
  })
  it('lists recent additions on top', () => {
    localStorage.clear()
    bar()
    fireEvent.keyDown(screen.getAllByRole('button', { name: /^Line$/ })[0]!, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy()
  })
  it('searches by name and category, and never hides when nothing matches', () => {
    bar()
    fireEvent.change(screen.getByPlaceholderText('Search assets'), { target: { value: 'heatmap' } })
    expect(screen.getByText(/Heatmap, hour by day/)).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Search results' })).toBeTruthy() // flat, across categories
    fireEvent.change(screen.getByPlaceholderText('Search assets'), { target: { value: 'zzzz' } })
    expect(screen.getByText(/No assets match/)).toBeTruthy()
  })
  it('adds with Enter and shows a favourites row', () => {
    const onAdd = vi.fn()
    localStorage.clear()
    bar(onAdd)
    fireEvent.click(screen.getByRole('button', { name: /^Single value/ }))
    const item = screen.getByRole('button', { name: /^Stat$/ })
    fireEvent.keyDown(item, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('stat')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Stat to favourites' })[0]!)
    expect(screen.getByRole('heading', { name: 'Favourites' })).toBeTruthy()
  })
})
