# Slides module (Role 2)

Upload a PDF (slide deck or prelecture handout), show it in the top-left panel with
prev/next navigation, and extract its text and key terms for the AI features.

Everything runs in the browser. The PDF never goes to the server.

## Using it

```jsx
import { SlidePanel } from './slides'

const [deck, setDeck] = useState(null)        // DeckContext, or null while loading
const [slideIndex, setSlideIndex] = useState(0)

<div className="slides-box">                  {/* must have a real height */}
  <SlidePanel
    index={slideIndex}
    onSlideChange={(index, timestampMs) => setSlideIndex(index)}
    onDeckReady={setDeck}
  />
</div>
<NotesEditor page={slideIndex} />             {/* notes are one page per slide */}
```

### Props

| Prop | Type | What it does |
| --- | --- | --- |
| `index` | `number` (optional) | Slide to show, 0-based. Pass it so the app owns the current slide and slides and notes can't disagree. Without it, the panel tracks the slide itself. |
| `onSlideChange` | `(index, timestampMs) => void` | Called on every slide change (buttons, keys) and with `0` when a new PDF opens. `timestampMs` is `Date.now()`. In controlled mode this is a request: set your state to apply it. |
| `onDeckReady` | `(deck \| null) => void` | Called with `null` the moment a new PDF opens (its text is still being read), then with the `DeckContext`. A failed upload calls nothing and the current deck stays. |

When a new PDF opens, the order is: `onDeckReady(null)`, `onSlideChange(0)`, `onDeckReady(deck)`.

### DeckContext

Defined in [`contract/stubDeckContext.js`](contract/stubDeckContext.js), which also exports a
placeholder (`import { stubDeckContext } from './slides'`).

```js
{
  filename: 'lecture.pdf',
  slideCount: 30,
  slides: [{ index: 0, text: 'Title\nFirst bullet' }], // index is 0-based, text is never null
  terms: ['JSX', 'virtual DOM', 'Vite'],                // up to 40, strongest first
  hasTextLayer: true,                                   // false for scanned PDFs
}
```

- Current slide text: `deck?.slides[slideIndex]?.text ?? ''`. It's `''` for image-only slides,
  scanned PDFs, and while `deck` is `null`.
- `terms` is meant for prompts and for priming transcription.

## Behavior worth knowing

- **Focus:** clicking ‹ / › never moves the cursor out of the notes editor. Arrow keys
  (and Page Up/Down, Home/End) change slides only while the panel itself has focus.
  Modifier combos (Cmd/Ctrl/Alt + arrows) are left alone for the editor and the app.
- **Scanned PDFs** display normally, with a notice that AI help can't read them.
- **Bad uploads** (not a PDF, empty, damaged, password-protected) show a message in the
  panel. Nothing else changes.

## Styling

The panel fills its container (100% width and height), so give that box a height through
your layout. It inherits your font and text color. Every class starts with `slide-panel`
or `slide-canvas`, so you can restyle it from your own CSS:

| Class | Element |
| --- | --- |
| `.slide-panel` | Root (shows a focus ring while it has keyboard focus) |
| `.slide-panel--empty` | Root before any upload |
| `.slide-panel__bar`, `.slide-panel__status` | Top row and status text |
| `.slide-panel__button` (`--small`, `--nav`) | All buttons (Replace, ‹ ›) |
| `.slide-panel__stage` | Area the slide sits in |
| `.slide-panel__nav`, `.slide-panel__counter` | Bottom row and "3 / 8" counter |
| `.slide-panel__error`, `.slide-panel__notice` | Upload error and scanned-PDF notice |
| `.slide-canvas`, `.slide-canvas__page` | Slide container and the page itself |

## Testing it on its own

```bash
cd client && npm run dev
```

Open <http://localhost:5173/slides-dev.html>. The page has the panel, a fake per-slide notes
editor, the current slide text, an `onSlideChange` log, and the extracted terms.

## Folder layout

| Folder | Contents |
| --- | --- |
| `index.js` | Public exports: `SlidePanel`, `stubDeckContext` |
| `components/` | `SlidePanel` (the panel) and `SlideCanvas` (draws one page) |
| `pdf/` | pdf.js setup, loading, upload checks, friendly error messages |
| `extraction/` | PDF to `DeckContext`: page text, term extraction, common-word list |
| `contract/` | The `DeckContext` shape and placeholder |
| `dev/` | The `slides-dev.html` test page (not part of the app) |

`extraction/commonWords.js` is a word-frequency list from
[FrequencyWords](https://github.com/hermitdave/FrequencyWords), licensed CC BY-SA 4.0
(credited in the file). That license covers only that file.
