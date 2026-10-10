// Single place pdf.js is configured. Always import pdfjsLib from here, never
// from 'pdfjs-dist' directly: without the worker set, pdf.js hangs silently.
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export { pdfjsLib }
