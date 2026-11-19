import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@omnimetrics/types'
import { authErrorResponse, requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const payload = await requireAuth(request)

    const sql = getDb()
    const rows = await sql<{ email: string }[]>`
      SELECT email FROM app_users WHERE id = ${payload.sub}
    `
    const email = rows[0]?.email
    if (email === undefined) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user: User = {
      id: payload.sub,
      username: payload.username,
      email,
      role: payload.role,
      allowed_projects: payload.allowed_projects,
    }
    const response = NextResponse.json({ user })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return authErrorResponse(error)
  }
}
