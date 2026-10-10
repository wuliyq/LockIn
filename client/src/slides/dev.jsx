// Dev harness for SlidePanel. Lets the slides module be built and tested without
// touching App.jsx (Role 1's layout). Open http://localhost:5173/slides-dev.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import DevHarness from './DevHarness'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Same theme as the app, so the panel looks here the way it will in the layout. */}
    <div className="theme-sage" style={{ minHeight: '100%', background: 'var(--background)', overflow: 'auto' }}>
      <DevHarness />
    </div>
  </StrictMode>,
)
