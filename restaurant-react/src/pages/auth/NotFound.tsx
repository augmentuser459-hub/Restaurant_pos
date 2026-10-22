import { Link, useLocation } from 'react-router-dom'
import { SearchX } from 'lucide-react'

// Shown for any address that doesn't match a page (inside the signed-in layout)
export default function NotFound() {
  const location = useLocation()

  return (
    <div className="bg-white rounded-lg shadow-sm p-8 text-center max-w-lg mx-auto mt-8">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <SearchX className="w-8 h-8 text-gray-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">الصفحة غير موجودة</h1>
      <p className="text-gray-600 mb-2">لا توجد صفحة بهذا العنوان. ربما تم نقلها أو أن الرابط غير صحيح.</p>
      <p className="text-sm text-gray-400 mb-6 break-all" dir="ltr">{location.pathname}</p>
      <Link
        to="/"
        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        العودة للرئيسية
      </Link>
    </div>
  )
}
