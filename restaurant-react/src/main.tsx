import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// After a new deploy, an open tab may request page chunks that no longer exist.
// Reload once to pick up the new version (guarded so a real outage can't cause a reload loop).
// The error itself still reaches the layout's error boundary, which offers a reload button.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'vite_preload_reload_at'
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable (private mode): leave it to the error boundary
    return
  }
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
