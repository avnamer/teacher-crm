import { signInWithGoogle } from '../lib/auth.js'

export default function Login() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-3">🎓</div>
        <h1 className="text-xl font-bold text-gray-800 mb-1">Teacher CRM</h1>
        <p className="text-gray-500 text-sm mb-6">התחברות נדרשת כדי להיכנס למערכת</p>
        <button
          onClick={() => signInWithGoogle()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          התחבר עם Google
        </button>
      </div>
    </div>
  )
}
