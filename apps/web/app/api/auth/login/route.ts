import { NextResponse, type NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { ROLES } from '@omnimetrics/types'
import { BCRYPT_COST } from '@/lib/admin/password'
import { getDb } from '@/lib/db'
import { getCurrentUserById, invalidateUserCache, setAuthCookie, signToken } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  clearFailures,
  getClientIp,
  MAX_FAILED_ATTEMPTS,
  rateLimitKey,
  recordFailure,
  retryAfterSeconds,
} from '@/lib/rate-limit'
import { sessionVersionEnabled } from '@/lib/session-version'

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
})

interface UserRow {
  id: string
  username: string
  email: string
  hashed_password: string
  role: string
  is_active: boolean
  token_version?: number
}

// Compared against when the username does not exist, so response time does not
// reveal whether an account exists.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('omnimetrics-dummy-password', BCRYPT_COST)
  return dummyHash
}

const INVALID = { error: 'Invalid username or password' }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }
  const { username, password } = parsed.data

  const ip = getClientIp(request)
  const limiterKey = rateLimitKey(ip, username)

  const retryAfter = retryAfterSeconds(limiterKey)
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const sql = getDb()
  // With the flag on, the version is read in the SAME statement as the hash it belongs to.
  const rows = sessionVersionEnabled()
    ? await sql<UserRow[]>`
    SELECT id, username, email, hashed_password, role, is_active, token_version
    FROM app_users
    WHERE username = ${username}
  `
    : await sql<UserRow[]>`
    SELECT id, username, email, hashed_password, role, is_active
    FROM app_users
    WHERE username = ${username}
  `
  const row = rows[0]

  const passwordOk = await bcrypt.compare(password, row?.hashed_password ?? (await getDummyHash()))
  const roleOk = row ? (ROLES as readonly string[]).includes(row.role) : false

  if (!row || !passwordOk || !row.is_active || !roleOk) {
    const failureCount = recordFailure(limiterKey)
    const reason = !row ? 'unknown_user' : !passwordOk ? 'bad_password' : !row.is_active ? 'inactive' : 'invalid_role'
    await writeAudit({
      userId: row?.id ?? null,
      action: 'login_failure',
      targetType: 'user',
      targetId: row?.id,
      detail: { username, reason, locked_out: failureCount >= MAX_FAILED_ATTEMPTS },
      ip: request.headers.get('x-real-ip'),
    })
    return NextResponse.json(INVALID, { status: 401 })
  }

  // Identity only: role and allowed_projects are derived from the DB by requireAuth().
  const token = await signToken({ sub: row.id, tv: row.token_version })

  clearFailures(limiterKey)
  await writeAudit({ userId: row.id, action: 'login_success', targetType: 'user', targetId: row.id, detail: { username: row.username }, ip: request.headers.get('x-real-ip') })

  // Warm requireAuth's cache with fresh permissions for this login.
  invalidateUserCache(row.id)
  const user = await getCurrentUserById(row.id)
  if (!user) return NextResponse.json(INVALID, { status: 401 })
  const response = NextResponse.json({ user })
  setAuthCookie(response, request, token)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
