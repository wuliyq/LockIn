// Single place pdf.js is configured. Always import pdfjsLib from here, never
// from 'pdfjs-dist' directly: without the worker set, pdf.js hangs silently.
//
// We use the legacy build: the modern one relies on very new JS (e.g.
// Map.prototype.getOrInsertComputed), which many current browsers don't have yet,
// so page rendering fails there even though text extraction works.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export { pdfjsLib }
