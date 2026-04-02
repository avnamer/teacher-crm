import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="text-6xl mb-4">404</div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">העמוד לא נמצא</h1>
      <Link to="/" className="text-blue-600 hover:underline">חזור לדשבורד</Link>
    </div>
  )
}
