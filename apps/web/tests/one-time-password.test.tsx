import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AccountsView } from '@/components/admin/accounts-view'
import { UsersView } from '@/components/admin/users-view'

// The one-time password: shown once after add and reset, held in component state only.

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

const OTP_ADD = 'otp-add-Zk3_9qLm-2Vx7TbNs'
const OTP_RESET = 'otp-reset-Hy6_1wQe-8Rt4UcPd'
const member = { userId: 'u1', username: 'sam', email: 'sam@example.test', role: 'viewer', active: true, isPlatform: false, grantsSummary: 'No grants yet', trackingFolders: [] }

function stubApi() {
  const gets: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as { op: string }) : null
    const json = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (!body) { gets.push(url); return json({ ok: true, members: [member], folders: [], sessions: [] }) }
    if (body.op === 'add') return json({ ok: true, member, oneTimePassword: OTP_ADD })
    if (body.op === 'reset') return json({ ok: true, message: 'Password reset.', oneTimePassword: OTP_RESET })
    return json({ ok: true, member })
  }))
  return gets
}

const dialog = () => screen.queryByRole('dialog', { name: 'One-time password' })
/** In the markup or in any field's value. */
const onPage = (secret: string) => document.body.innerHTML.includes(secret) || [...document.querySelectorAll('input')].some((i) => i.value.includes(secret))
const stored = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, window.location.href])

/** The panel is up AND its effects (focus, pagehide listener) have run: the markup alone appears earlier. */
async function panelReady() {
  await screen.findByRole('dialog', { name: 'One-time password' })
  await waitFor(() => expect(dialog()!.contains(document.activeElement)).toBe(true))
}

async function addUser() {
  const trigger = await screen.findByRole('button', { name: 'Add user' })
  trigger.focus()
  fireEvent.click(trigger)
  const drawer = screen.getByRole('dialog', { name: /Add user to/ })
  fireEvent.change(within(drawer).getByLabelText('Username'), { target: { value: 'new.person' } })
  fireEvent.change(within(drawer).getByLabelText('Email'), { target: { value: 'new@example.test' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Add user' }))
  await panelReady()
  return trigger
}

describe('one-time password panel', () => {
  it('after add user: username, read-only monospace field, the warning; focus in and back; gone for good', async () => {
    const gets = stubApi()
    const view = render(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    await screen.findByText('sam')
    const trigger = await addUser()
    const panel = within(dialog()!)
    expect(panel.getByText('new.person')).toBeInTheDocument()
    const field = panel.getByLabelText('Password') as HTMLInputElement
    expect(field.value).toBe(OTP_ADD)
    expect(field.readOnly).toBe(true)
    expect(field.className).toContain('font-mono')
    expect(panel.getByText(/shown once and cannot be recovered/)).toBeInTheDocument()
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    await waitFor(() => expect(gets.length).toBeGreaterThan(1)) // the list was reloaded behind the panel
    expect(stored()).not.toContain(OTP_ADD)
    expect(gets.join()).not.toContain(OTP_ADD)

    fireEvent.click(panel.getByRole('button', { name: 'Done' }))
    expect(dialog()).toBeNull()
    expect(onPage(OTP_ADD)).toBe(false)
    expect(document.activeElement).toBe(trigger)

    view.rerender(<UsersView orgSlug="dev" orgName="Dev again" isDirector />)
    fireEvent.change(screen.getByLabelText(/Role of sam/), { target: { value: 'builder' } }) // reloads the list
    await screen.findByText('Role changed for sam.')
    expect(onPage(OTP_ADD)).toBe(false)
  })

  it('after reset password: shown, Escape dismisses, focus returns to that button', async () => {
    stubApi()
    const view = render(<AccountsView orgSlug="dev" orgName="Dev" />)
    const trigger = await screen.findByRole('button', { name: 'Reset password for sam' })
    fireEvent.click(trigger)
    await panelReady()
    expect(within(dialog()!).getByText('sam')).toBeInTheDocument()
    expect((within(dialog()!).getByLabelText('Password') as HTMLInputElement).value).toBe(OTP_RESET)
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    expect(stored()).not.toContain(OTP_RESET)

    fireEvent.keyDown(dialog()!, { key: 'Escape' })
    expect(dialog()).toBeNull()
    expect(onPage(OTP_RESET)).toBe(false)
    expect(document.activeElement).toBe(trigger)
    view.rerender(<AccountsView orgSlug="dev" orgName="Dev again" />)
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await screen.findByText(/sam deactivated/)
    expect(onPage(OTP_RESET)).toBe(false)
  })

  it('is gone after leaving the page and coming back', async () => {
    stubApi()
    const view = render(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    await addUser()
    fireEvent(window, new Event('pagehide'))
    expect(dialog()).toBeNull()
    await addUser()
    view.unmount()
    render(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    await screen.findByText('sam')
    expect(dialog()).toBeNull()
    expect(onPage(OTP_ADD)).toBe(false)
  })

  it('Copy writes the password and announces "Copied"', async () => {
    stubApi()
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    await addUser()
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(within(dialog()!).getByRole('status').textContent).toBe('Copied'))
    expect(writeText).toHaveBeenCalledWith(OTP_ADD)
  })

  it('without a clipboard (plain http) it selects the field and says so instead of claiming success', async () => {
    stubApi()
    vi.stubGlobal('navigator', {})
    render(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    await addUser()
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(within(dialog()!).getByRole('status').textContent).toMatch(/^Copy failed/))
    const field = within(dialog()!).getByLabelText('Password') as HTMLInputElement
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, OTP_ADD.length])
  })
})
