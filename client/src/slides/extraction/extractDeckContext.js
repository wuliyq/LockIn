import { extractTerms } from './extractTerms'

/**
 * Build the DeckContext (see stubDeckContext.js) from a loaded pdf.js document.
 * Runs once per upload. Works for slide decks and prelecture handouts; each PDF
 * page becomes one entry in `slides`.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {string} filename
 * @returns {Promise<import('../contract/stubDeckContext').DeckContext>}
 */
export async function extractDeckContext(doc, filename) {
  const pages = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const [, yMin, , yMax] = page.view // page box in PDF units
    pages.push(itemsToLines(content.items, yMin, yMax - yMin || 1))
  }

  const slides = pages.map((lines, index) => ({
    index,
    text: lines.map((line) => line.text).join('\n'),
  }))

  return {
    filename,
    slideCount: doc.numPages,
    slides,
    terms: extractTerms(pages),
    // Scanned PDFs come back with every page empty (or a stray page number).
    hasTextLayer: slides.some((slide) => slide.text.length > 20),
  }
}

/**
 * pdf.js returns positioned text fragments, not lines. Group them into lines,
 * keeping each line's font size (largest on a page is usually the title) and its
 * height on the page (0 = bottom, 1 = top), which flags headers and footers.
 *
 * `hasEOL` alone isn't reliable (titles often lack it), so a jump in vertical
 * position also starts a new line.
 *
 * @returns {Array<{ text: string, size: number, y: number }>}
 */
function itemsToLines(items, yMin, pageHeight) {
  const lines = []
  let line = null

  const flush = () => {
    if (!line) return
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (text) lines.push({ text, size: line.size, y: (line.y - yMin) / pageHeight })
    line = null
  }

  for (const item of items) {
    // Skip marked-content markers, which carry no text.
    if (typeof item.str !== 'string') continue

    const [, , c, d, x, y] = item.transform
    const size = Math.hypot(c, d)

    if (line && Math.abs(y - line.y) > Math.max(size, line.size) * 0.5) flush()

    if (item.str) {
      if (!line) {
        line = { text: '', size: 0, y, endX: x }
      } else if (x - line.endX > size * 0.15) {
        // Visible gap between fragments means a word break.
        line.text += ' '
      }
      line.text += item.str
      line.size = Math.max(line.size, size)
      line.endX = x + item.width
    }

    if (item.hasEOL) flush()
  }
  flush()

  return lines
}
