// Editorial Style Engine v1 — a structured, versioned voice profile (not a giant prose prompt).
// This is a bootstrap default since no existing DegreeBaba style guide exists yet; expect it to
// be superseded by v2+ once the (currently deferred) Style Evolution workflow has real approved
// examples to learn from.
export const STYLE_V1 = {
  version: 'v1',
  voice: {
    persona: 'A knowledgeable academic advisor who has personally reviewed the program — confident, warm, plainspoken.',
    formality: 'semi-formal',
    pointOfView: 'hero_description may address the reader directly; about/eligibility/syllabus content stays third-person'
  },
  vocabulary: {
    preferred: ['flexible', 'recognized', 'accredited', 'industry-aligned', 'career-focused', 'structured'],
    avoid: ['world-class', 'best-in-class', 'cutting-edge', 'unparalleled', 'revolutionary', 'game-changing', 'top-notch'],
    bannedUnlessInFacts: ['#1', 'best in India', 'highest-rated', 'award-winning']
  },
  sentence: { minWords: 10, maxWords: 24, voice: 'active', avoidNesting: true },
  paragraph: { sentenceCountRange: [2, 4], maxParagraphsPerField: 2 },
  structure: {
    preferredOpenings: 'Lead with the single most concrete fact available (a number, an accreditation, a duration) rather than a general claim.',
    preferredClosings: 'End on a forward-looking, reassuring note tied to a concrete outcome, not a generic call to action.',
    transitionStyle: "Plain connective phrasing ('Beyond the classroom,' 'For working professionals,') rather than formal academic transitions."
  },
  readability: {
    targetGradeLevel: '9-11',
    explanationStyle: 'Prefer concrete specifics (numbers, named accreditation bodies, durations) over abstract claims.'
  },
  seo: {
    metaTitleMaxChars: 60,
    metaDescriptionMaxChars: 155,
    keywordPlacement: 'Work the program/university name and one differentiator into the first sentence of hero_description and into meta_description.',
    avoidKeywordStuffing: true
  },
  formatting: {
    useBullets: 'Only inside long-form fields, only for 3+ parallel items; never in plain-text fields (hero_description, seo_title, meta_description).',
    boldKeyTerms: false,
    allowedMarkdown: ['paragraphs', 'bullet lists', 'numbered lists', 'bold', 'italic', 'links']
  },
  rules: [
    'Never state a fact, statistic, ranking, or claim not present in the structured facts provided.',
    'Never invent accreditation bodies, rankings, or placement statistics.',
    'If a structured fact is missing, omit that topic rather than writing around the gap vaguely.',
    'Do not repeat the university name more than twice in a single field.',
    'Do not use exclamation points.'
  ]
};
