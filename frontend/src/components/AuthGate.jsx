import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { ALLOWED_EMAIL, signOut } from '../lib/auth.js'
import Login from '../pages/Login.jsx'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    // getSession() and onAuthStateChange (which also fires an INITIAL_SESSION
    // event) are intentionally redundant; whichever resolves reflects the same
    // cached session. On a getSession() failure, fall through to the login
    // screen rather than hanging on the loading spinner.
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null))
      .catch(() => setSession(null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s ?? null)
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">טוען...</p>
      </div>
    )
  }

  if (!session) return <Login />

  const email = (session.user?.email || '').toLowerCase()
  if (email !== ALLOWED_EMAIL) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🚫</div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">אין הרשאה</h1>
          <p className="text-gray-500 text-sm mb-6">
            החשבון {email} אינו מורשה לגשת למערכת.
          </p>
          <button
            onClick={() => signOut()}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2.5 rounded-lg"
          >
            התנתק
          </button>
        </div>
      </div>
    )
  }

  return children
}
