export type HumanizerMode = 'fiction' | 'nonfiction' | 'structured' | 'copy'

export interface HumanizerDirectiveOptions {
  voiceSample?: string
  mode?: HumanizerMode
}

const CORE_RULES = [
  'State the point directly. Lead with the action, decision, or concrete fact.',
  'Vary sentence openings and lengths. Do not force triads or repeat a sentence opening.',
  'Use plain verbs: is, are, has. Do not write "serves as", "boasts", or "features" instead.',
  'Keep specific details, mixed feelings, and uneven rhythm; they carry voice.',
]

const FORBIDDEN = [
  '"Not X but Y" framing, "not only... but also", and clipped negative endings.',
  'One-line closers, dramatic fragment rows, and aphorisms that restate the previous sentence.',
  'Staged run-ups: "Let\'s dive in", "Here\'s the thing", "Honestly?", "At its core".',
  'Arguing with no one, or rejecting a fake alternative no reader considered.',
  'Inflated significance: "marking a pivotal moment", "underscores the importance", "setting the stage".',
  'Sales language: "nestled", "breathtaking", "vibrant", "renowned", "in the heart of".',
  'Shallow -ing riders: "..., highlighting/symbolizing/reflecting/showcasing ...".',
  'Vague authority: "experts believe", "observers have noted", "studies show" without a named source.',
  'Stacked qualifiers: "could potentially", "might arguably", "possibly be argued".',
  'Formulaic sayings: "X is the language of Y", "X becomes a trap".',
  'Chatbot residue, knowledge-limit disclaimers, sycophancy, and generic positive endings.',
  'Filler: "in order to", "due to the fact that", "it is important to note that".',
]

const FORMAT_RULES = [
  'No em dashes or en dashes unless the voice sample uses them at a similar rate. Replace with a period, comma, colon, or parentheses.',
  'No emojis, decorative bold, or Title Case headings.',
  'Use straight quotation marks.',
  'Do not restate a heading in the first sentence under it.',
]

export function buildHumanizerDirective(options: HumanizerDirectiveOptions = {}): string {
  const mode = options.mode ?? 'fiction'
  const sample = options.voiceSample?.trim()
  const scope = mode === 'structured'
    ? 'Apply these rules to every prose value you write. Leave JSON keys, code, and syntax untouched.'
    : mode === 'copy'
      ? 'These rules govern all user-facing copy and UI text.'
      : 'These rules govern the prose you write for this story.'

  const voice = sample
    ? `Match this writing sample's rhythm, diction, punctuation, and deliberate quirks. Its dash rate overrides the dash rule:\n"""\n${sample.slice(0, 1600)}\n"""`
    : ''

  const fictionNote = mode === 'fiction'
    ? 'Fiction may invent story details. Keep every name, date, number, and quote consistent with the project data, and never present an invented detail as real-world fact. Keep the narrator\'s voice and the character\'s diction.'
    : 'Do not add any factual claim that is not in the source, and do not lose any claim the source makes.'

  return [
    'Human prose rules. ' + scope,
    fictionNote,
    voice,
    'Always:\n- ' + CORE_RULES.join('\n- '),
    'Never:\n- ' + FORBIDDEN.join('\n- '),
    'Formatting:\n- ' + FORMAT_RULES.join('\n- '),
    'Before returning: reread the prose for rhythm, and confirm no fact was added or lost.',
  ].filter(Boolean).join('\n\n')
}

export function withHumanizer(prompt: string, options: HumanizerDirectiveOptions = {}): string {
  return `${prompt}\n\n${buildHumanizerDirective(options)}`
}
