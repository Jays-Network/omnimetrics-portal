import { redirect } from 'next/navigation'

// Middleware sends unauthenticated users on to /login.
export default function Home() {
  redirect('/dashboard')
}
