import { NextResponse, type NextRequest } from 'next/server'
import { authErrorResponse, requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const response = NextResponse.json({ user })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return authErrorResponse(error)
  }
}
