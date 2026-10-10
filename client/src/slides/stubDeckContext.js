/**
 * DeckContext: the contract between the slides module (Role 2) and everyone
 * who consumes slide content (Role 3 prompts, Role 4 transcription priming).
 *
 * Produced once at PDF upload and cached in app state. Never re-derived per API call.
 *
 * - `index` is 0-based everywhere. Display 1-based in UI only.
 * - `text` is always a string, never null. A slide with no text is "".
 *   Lines are joined with "\n" (handout paragraphs keep their line breaks).
 * - A "slide" is one PDF page: the upload may be a slide deck or a prelecture handout.
 * - `hasTextLayer` is false for scanned PDFs (no usable text, no OCR).
 *
 * @typedef {Object} Slide
 * @property {number} index  0-based slide index
 * @property {string} text   extracted text, one line per "\n", "" if none
 *
 * @typedef {Object} DeckContext
 * @property {string}   filename
 * @property {number}   slideCount
 * @property {Slide[]}  slides
 * @property {string[]} terms         up to 40 domain terms, strongest first, for prompts + STT priming
 * @property {boolean}  hasTextLayer
 */

// Hardcoded placeholder for building and testing without uploading a PDF.
// Real data comes from <SlidePanel onDeckReady={...} /> (see extractDeckContext.js),
// which sends null while a newly opened PDF's text is still being read.
/** @type {DeckContext} */
export const stubDeckContext = {
  filename: "demo-lecture.pdf",
  slideCount: 6,
  slides: [
    {
      index: 0,
      text: "Cellular Respiration Overview BIOL 101 Lecture 12",
    },
    {
      index: 1,
      text: "Glycolysis Occurs in the cytoplasm Glucose (6C) is split into two pyruvate (3C) Net yield: 2 ATP, 2 NADH No oxygen required",
    },
    {
      index: 2,
      text: "Pyruvate Oxidation Pyruvate enters the mitochondrion Converted to acetyl-CoA, releasing CO2 Produces NADH",
    },
    {
      index: 3,
      text: "Krebs Cycle (Citric Acid Cycle) Takes place in the mitochondrial matrix Each turn yields 3 NADH, 1 FADH2, 1 ATP Two turns per glucose",
    },
    {
      index: 4,
      text: "Electron Transport Chain Located in the inner mitochondrial membrane NADH and FADH2 donate electrons Proton gradient drives ATP synthase Oxygen is the final electron acceptor",
    },
    {
      index: 5,
      text: "Oxidative Phosphorylation Chemiosmosis produces roughly 26 to 28 ATP Total yield per glucose: about 30 to 32 ATP",
    },
  ],
  terms: [
    "cellular respiration",
    "glycolysis",
    "pyruvate",
    "ATP",
    "NADH",
    "FADH2",
    "acetyl-CoA",
    "mitochondrion",
    "mitochondrial matrix",
    "Krebs cycle",
    "citric acid cycle",
    "electron transport chain",
    "ATP synthase",
    "proton gradient",
    "chemiosmosis",
    "oxidative phosphorylation",
  ],
  hasTextLayer: true,
};
