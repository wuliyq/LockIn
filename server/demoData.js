/**
 * Sample flags for demos and testing the lecturer dashboard without a live class.
 * Matches the 10-slide "Lecture 7: Gradient Descent" test deck. The highlighted
 * texts are invented examples, not real student data.
 *
 * Deterministic: the same call always produces the same lecture, ending now.
 */

// [slide, minute range in the lecture, { flagType: [count, ...sample highlighted texts] }]
// Catch-ups summarise the recording, so they carry no highlighted text here.
const PLAN = [
  [1, [0, 3], {}],
  [2, [3, 6], { check_thinking: [1, 'Is backprop part of today or next week?'] }],
  [3, [6, 11], {
    confusing: [2, 'Why do we square the error instead of using absolute value?', 'What does the n stand for in the loss formula?'],
    check_thinking: [1, 'So lower loss always means a better model, right?'],
  }],
  [4, [11, 16], {
    confusing: [3, 'How can a vector point in a direction of a function?', 'What is a partial derivative again?', 'Why is the gradient zero at the minimum?'],
    example: [2, 'What does a gradient look like for a real model?', 'Is there an everyday example of steepest ascent?'],
  }],
  [5, [16, 24], {
    confusing: [7, 'Why do we move opposite the gradient instead of along it?', 'Why the minus sign in the update rule?', 'What does eta multiply exactly?', 'How do we know when to stop repeating?', 'Is w one number or all the weights?', 'Why does going against the gradient reduce loss?', 'What is the arrow in the formula?'],
    catch_up: [3],
    why_it_matters: [2, 'gradient descent trains almost every ML model', 'same update rule as in neural nets'],
    check_thinking: [2, 'If the gradient is negative we increase w, is that right?', 'So a bigger gradient means a bigger step?'],
  }],
  [6, [24, 27], {
    check_thinking: [3, 'Do the dots get closer because the slope gets smaller?', 'Is each dot one iteration?', 'Would a bigger learning rate skip past the bottom?'],
  }],
  [7, [27, 33], {
    why_it_matters: [2, 'learning rate is the most important setting to tune', 'too big and training diverges'],
    example: [4, 'What learning rate do people actually use for neural nets?', 'Is there a real case where a big learning rate broke training?', 'How do I pick eta for my homework model?', 'What does diverging look like on a loss plot?'],
    confusing: [2, 'What is a learning-rate schedule?', 'Why would the loss go up if the step is too big?'],
  }],
  [8, [33, 41], {
    catch_up: [4],
    confusing: [3, 'Why is SGD noisy?', 'How does noise help escape minima?', 'What is the difference between an epoch and an iteration?'],
  }],
  [9, [41, 47], {
    confusing: [2, 'What is a saddle point?', 'Why do features on different scales slow things down?'],
    example: [3, 'When would standardizing inputs matter in practice?', 'Where is Adam used in real projects?', 'Can you give an example of a local minimum problem?'],
  }],
  [10, [47, 50], { check_thinking: [1, 'So mini-batch SGD with a schedule is the default?'] }],
]

const SOURCES = ['slide', 'notes', 'transcript']

/** Small seeded generator so the sample is the same every time. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function buildDemoFlags(now = Date.now()) {
  const rand = rng(7)
  const start = now - 50 * 60000
  const flags = []
  for (const [slide, [from, to], types] of PLAN) {
    for (const [flagType, [count, ...questions]] of Object.entries(types)) {
      for (let i = 0; i < count; i++) {
        const minute = from + rand() * (to - from)
        flags.push({
          slideNumber: slide,
          flagType,
          // The highlighted text is the query; about a third flag the slide without highlighting.
          selectedText: rand() < 0.7 && questions.length ? questions[i % questions.length] : '',
          studentComment: '',
          aiAnswer: '',
          source: SOURCES[Math.floor(rand() * SOURCES.length)],
          timestamp: new Date(start + minute * 60000).toISOString(),
        })
      }
    }
  }
  return flags.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
