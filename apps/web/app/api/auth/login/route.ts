import { NextResponse, type NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { ROLES, type Role, type User } from '@omnimetrics/types'
import { getDb } from '@/lib/db'
import { setAuthCookie, signToken } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'
import {
  clearFailures,
  getClientIp,
  MAX_FAILED_ATTEMPTS,
  rateLimitKey,
  recordFailure,
  retryAfterSeconds,
} from '@/lib/rate-limit'

const BCRYPT_COST = 12

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
  const rows = await sql<UserRow[]>`
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
    await writeAuditLog(row?.id ?? null, 'login_failure', {
      username,
      ip,
      reason,
      locked_out: failureCount >= MAX_FAILED_ATTEMPTS,
    })
    return NextResponse.json(INVALID, { status: 401 })
  }

  const role = row.role as Role

  // allowed_projects is null ONLY for admin. Builders/viewers get their
  // app_user_projects rows; no rows = empty array = they see nothing.
  let allowedProjects: string[] | null = null
  if (role !== 'admin') {
    const projectRows = await sql<{ folder_name: string }[]>`
      SELECT folder_name FROM app_user_projects
      WHERE user_id = ${row.id}
      ORDER BY folder_name
    `
    allowedProjects = projectRows.map((p) => p.folder_name)
  }

  const token = await signToken({
    sub: row.id,
    username: row.username,
    role,
    allowed_projects: allowedProjects,
  })

  clearFailures(limiterKey)
  await writeAuditLog(row.id, 'login_success', { username: row.username, ip })

  const user: User = {
    id: row.id,
    username: row.username,
    email: row.email,
    role,
    allowed_projects: allowedProjects,
  }
  const response = NextResponse.json({ user })
  setAuthCookie(response, request, token)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
