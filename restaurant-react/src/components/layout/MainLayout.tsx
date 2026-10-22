import { useState, Component, Suspense, ReactNode, ErrorInfo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

// A lazy-loaded page chunk that can't be fetched (usually: a new version was deployed while this tab was open)
function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false
  return /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
    `${error.name} ${error.message}`
  )
}

// Error Boundary: catches a page crash so the sidebar/navbar stay usable.
// It resets when the route changes (resetKey) or when the user presses "retry".
class ErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; resetKey: string }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  componentDidUpdate(prevProps: { resetKey: string }, prevState: { hasError: boolean }) {
    // Navigating to another page clears the error so the new page can render.
    // Only when the error was already showing: if the page we just navigated to is the one that threw,
    // resetting here would make it throw a second time.
    if (this.state.hasError && prevState.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error)
      return (
        <div className="p-8 bg-red-50 border border-red-200 rounded-lg m-4">
          <h2 className="text-xl font-bold text-red-700 mb-2">
            {chunkError ? 'تم تحديث النظام' : 'حدث خطأ'}
          </h2>
          <p className="text-red-600">
            {chunkError
              ? 'يوجد إصدار جديد من النظام. يرجى إعادة تحميل الصفحة للمتابعة.'
              : 'تعذر عرض هذه الصفحة. يمكنك إعادة المحاولة أو الانتقال إلى صفحة أخرى من القائمة.'}
          </p>
          {!chunkError && this.state.error?.message && (
            <p className="text-sm text-red-500 mt-2 break-words" dir="auto">{this.state.error.message}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {!chunkError && (
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-4 py-2 bg-white text-red-700 border border-red-300 rounded-lg hover:bg-red-100"
              >
                إعادة المحاولة
              </button>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// Shown while a lazy-loaded page chunk is downloading
function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      <span className="sr-only">جاري التحميل...</span>
    </div>
  )
}

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar - Hidden when printing */}
      <div className="print:hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area */}
      <div className="lg:mr-64 print:!mr-0">
        {/* Navbar - Hidden when printing */}
        <div className="print:hidden">
          <Navbar onMenuClick={() => setSidebarOpen(true)} />
        </div>

        {/* Page content */}
        <main className="p-4 lg:p-6 print:!p-0">
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
