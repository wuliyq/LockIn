import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountApp from './account/AccountApp.jsx'

// ?view=lecturer still opens the lecturer dashboard directly (handy for demos);
// everything else starts at the login page.
const LecturerApp = lazy(() => import('./lecturer/LecturerApp.jsx'))
const isLecturer = new URLSearchParams(window.location.search).get('view') === 'lecturer'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLecturer ? (
      <Suspense fallback={null}>
        <LecturerApp />
      </Suspense>
    ) : (
      <AccountApp />
    )}
  </StrictMode>,
)
