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
 * Catch files that can't be a PDF before handing them to pdf.js. The file picker
 * filters to .pdf, but "All Files" and renamed files still get through.
 *
 * @param {File} file
 * @returns {string | null} a student-facing reason, or null if it's worth trying
 */
export function checkPdfFile(file) {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!looksLikePdf) return "It isn't a PDF. Choose a .pdf file."
  if (file.size === 0) return 'The file is empty.'
  return null
}

/**
 * Turn a pdf.js load error into something a student can act on. The raw error
 * still goes to the console for debugging.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeLoadError(err) {
  if (err instanceof pdfjsLib.PasswordException) {
    return "It's password-protected. Remove the password and upload it again."
  }
  if (err instanceof pdfjsLib.InvalidPDFException) {
    return "It looks damaged, or it isn't really a PDF. Try exporting it again."
  }
  return 'Something went wrong reading it. Try exporting the PDF again.'
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
