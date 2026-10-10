// Dev harness for SlidePanel. Lets the slides module be built and tested without
// touching App.jsx (Role 1's layout). Open http://localhost:5173/slides-dev.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DevHarness from './DevHarness'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DevHarness />
  </StrictMode>,
)
