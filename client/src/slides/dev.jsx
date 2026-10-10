// Dev harness for SlidePanel. Lets the slides module be built and tested without
// touching App.jsx (Role 1's layout). Open http://localhost:5173/slides-dev.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SlidePanel from './SlidePanel'

// Roughly the size of the top-left panel in the three-panel layout.
const boxStyle = {
  width: 420,
  height: 320,
  border: '1px dashed #888',
  margin: 24,
  fontFamily: 'system-ui, sans-serif',
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div style={boxStyle}>
      <SlidePanel
        onDeckReady={(deck) => console.log('[dev] onDeckReady', deck)}
        onSlideChange={(index, ts) => console.log('[dev] onSlideChange', index, ts)}
      />
    </div>
  </StrictMode>,
)
