// Public entry for the slides module. Import from here, not from the files inside:
//   import { SlidePanel } from './slides'
export { default as SlidePanel } from './components/SlidePanel'

// Row of fixed-width slide thumbnails for a PDF File (used by the lecturer dashboard).
export { default as SlideStrip } from './components/SlideStrip'

// Placeholder DeckContext for building and testing without uploading a PDF.
export { stubDeckContext } from './contract/stubDeckContext'
