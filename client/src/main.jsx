import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The lecturer dashboard lives at ?view=lecturer and only loads when opened there.
const LecturerApp = lazy(() => import('./lecturer/LecturerApp.jsx'))
const isLecturer = new URLSearchParams(window.location.search).get('view') === 'lecturer'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLecturer ? (
      <Suspense fallback={null}>
        <LecturerApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
