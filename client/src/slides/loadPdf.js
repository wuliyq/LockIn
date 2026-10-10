import { pdfjsLib } from './pdfSetup'

/**
 * Parse a user-selected PDF (slide deck or prelecture handout) into a pdf.js document.
 * Errors from pdf.js (bad file, password-protected, etc.) are passed through as-is.
 *
 * @param {File} file
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdf(file) {
  // pdf.js takes ownership of the buffer it's given, so wrap a fresh one per load.
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjsLib.getDocument({ data }).promise
}

/**
 * Free a document's worker-side resources. In pdf.js 6 the document itself has
 * no destroy(); it lives on the loading task.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy | null} doc
 */
export function closePdf(doc) {
  if (doc) doc.loadingTask.destroy()
}
