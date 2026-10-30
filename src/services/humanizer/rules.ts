export type HumanizerSeverity = 'high' | 'medium' | 'low'

export interface HumanizerMatch {
  excerpt: string
  index: number
}

export interface HumanizerRule {
  id: string
  label: string
  severity: HumanizerSeverity
  advice: string
  detect: (text: string) => HumanizerMatch[]
}

function excerptAt(text: string, index: number, length = 90): string {
  const start = Math.max(0, index - 30)
  return text.slice(start, Math.min(text.length, start + length)).replace(/\s+/g, ' ').trim()
}

function phraseDetector(phrases: string[]): (text: string) => HumanizerMatch[] {
  return text => {
    const matches: HumanizerMatch[] = []
    const lower = text.toLowerCase()
    for (const phrase of phrases) {
      let from = 0
      while (from < lower.length) {
        const index = lower.indexOf(phrase.toLowerCase(), from)
        if (index === -1) break
        matches.push({ excerpt: excerptAt(text, index), index })
        from = index + phrase.length
      }
    }
    return matches
  }
}

function patternDetector(pattern: RegExp): (text: string) => HumanizerMatch[] {
  return text => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const regex = new RegExp(pattern.source, flags)
    const matches: HumanizerMatch[] = []
    let match: RegExpExecArray | null
    while ((match = regex.exec(text))) {
      matches.push({ excerpt: excerptAt(text, match.index), index: match.index })
      if (match.index === regex.lastIndex) regex.lastIndex++
    }
    return matches
  }
}

const AI_WORDS = [
  'delve', 'tapestry', 'testament', 'pivotal', 'crucial', 'showcase', 'showcasing',
  'underscore', 'underscores', 'fostering', 'intricate', 'interplay', 'vibrant',
  'enduring', 'garner', 'garnered', 'enhance', 'enhances', 'elevate', 'seamless',
  'leverage', 'robust', 'holistic', 'myriad', 'realm', 'navigate the', 'landscape of',
]

function aiWordDetector(text: string): HumanizerMatch[] {
  const matches: HumanizerMatch[] = []
  const lower = text.toLowerCase()
  for (const word of AI_WORDS) {
    let from = 0
    while (from < lower.length) {
      const index = lower.indexOf(word, from)
      if (index === -1) break
      matches.push({ excerpt: excerptAt(text, index), index })
      from = index + word.length
    }
  }
  return matches
}

function dashDetector(text: string): HumanizerMatch[] {
  return patternDetector(/[—–]|(?:\s--\s)/)(text)
}

function boldDetector(text: string): HumanizerMatch[] {
  return patternDetector(/\*\*[^*\n]{1,60}\*\*/)(text)
}

function repeatedOpeningDetector(text: string): HumanizerMatch[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
  const matches: HumanizerMatch[] = []
  for (let index = 2; index < sentences.length; index++) {
    const current = sentences[index].split(/\s+/)[0]?.toLowerCase()
    const previous = sentences[index - 1].split(/\s+/)[0]?.toLowerCase()
    const before = sentences[index - 2].split(/\s+/)[0]?.toLowerCase()
    if (current && current === previous && current === before) {
      matches.push({ excerpt: `${sentences[index - 2]} ${sentences[index - 1]} ${sentences[index]}`.slice(0, 120), index: 0 })
    }
  }
  return matches
}

function fragmentDetector(text: string): HumanizerMatch[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
  let run = 0
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length
    run = words <= 5 ? run + 1 : 0
    if (run >= 3) return [{ excerpt: sentence, index: 0 }]
  }
  return []
}

export const HUMANIZER_RULES: HumanizerRule[] = [
  {
    id: 'chatbot-residue',
    label: 'Chatbot residue',
    severity: 'high',
    advice: 'Remove the wrapper and keep the content.',
    detect: patternDetector(/\b(i hope this helps|great question|you'?re absolutely right|that'?s an excellent point|of course!|certainly!|would you like me to|want me to|let me know|here'?s an? (overview|summary|breakdown))\b/i),
  },
  {
    id: 'knowledge-disclaimer',
    label: 'Knowledge-limit disclaimer or guess',
    severity: 'high',
    advice: 'State what the source shows, or cut the sentence. Never present a guess as fact.',
    detect: patternDetector(/\b(as of my last|up to my last training|based on available information|not publicly available|while (specific )?details are (limited|scarce)|it is believed that|likely (grew up|studied|began))\b/i),
  },
  {
    id: 'staged-runup',
    label: 'Staged run-up or announced next point',
    severity: 'high',
    advice: 'Remove the run-up and state the point.',
    detect: patternDetector(/(^|\n)\s*(honestly\?|look,|here'?s the thing|the thing is|let'?s (dive in|explore|break this down)|here'?s what you need to know|without further ado|now let'?s look at|quick note|heads up)|\b(at its core|the real question is|in reality,|what really matters is|fundamentally,)\b/i),
  },
  {
    id: 'not-x-but-y',
    label: 'Not X but Y framing',
    severity: 'high',
    advice: 'State the claim directly.',
    detect: patternDetector(/\b(it'?s|it is|this is|that'?s|that is)\s+not\s+(just|only|merely)\b[^.!?\n]{0,90}\b(it'?s|it is|but)\b|\bnot only\b[^.!?\n]{0,90}\bbut also\b/i),
  },
  {
    id: 'arguing-nobody',
    label: 'Arguing with no one or rejecting a fake alternative',
    severity: 'high',
    advice: 'Remove the unraised objection or fake option; keep any real claim.',
    detect: patternDetector(/\b(i'?m not (saying|arguing|trying to)|this isn'?t (mainly|really|about)|don'?t get me wrong|to be clear,|a tempting (approach|option) would be|you might think|some might say|some would suggest)\b/i),
  },
  {
    id: 'inflated-significance',
    label: 'Inflated significance or legacy',
    severity: 'high',
    advice: 'Keep the fact and drop the significance claim.',
    detect: patternDetector(/\b(stands? as|serves? as (a |an )?(testament|reminder|symbol)|marks? (a )?(pivotal|key|turning)|marking (a )?(pivotal|key|turning)|underscores? (the )?(importance|significance)|reflects? broader|indelible mark|evolving landscape|setting the stage for|deeply rooted)\b/i),
  },
  {
    id: 'shallow-ing',
    label: 'Shallow -ing rider',
    severity: 'high',
    advice: 'Keep only what the source supports; state the effect directly.',
    detect: patternDetector(/,\s*(highlighting|underscoring|emphasizing|ensuring|reflecting|symbolizing|contributing to|cultivating|fostering|encompassing|showcasing)\b/i),
  },
  {
    id: 'sales-language',
    label: 'Sales language',
    severity: 'high',
    advice: 'State what the thing is.',
    detect: phraseDetector([
      'nestled', 'breathtaking', 'stunning', 'renowned', 'must-visit', 'in the heart of',
      'boasts', 'groundbreaking', 'unparalleled', 'world-class', 'vibrant',
    ]),
  },
  {
    id: 'vague-source',
    label: 'Vague source or borrowed authority',
    severity: 'high',
    advice: 'Name a real source and what it said, or remove the claim.',
    detect: patternDetector(/\b(experts (believe|argue|say)|observers have|some critics (argue|say)|industry reports|studies (show|suggest)|sources say|cited in)\b/i),
  },
  {
    id: 'generic-positive-ending',
    label: 'Generic positive ending',
    severity: 'high',
    advice: 'End on the last concrete fact instead of a send-off.',
    detect: patternDetector(/\b(the future looks bright|exciting times (lie ahead|await)|continues? to thrive|major step in the right direction|journey toward excellence)\b/i),
  },
  {
    id: 'ai-words',
    label: 'Overused AI vocabulary',
    severity: 'medium',
    advice: 'Replace with plain words the character would use.',
    detect: aiWordDetector,
  },
  {
    id: 'avoid-is-are',
    label: 'Avoiding is, are, or has',
    severity: 'medium',
    advice: 'Use is, are, or has.',
    detect: patternDetector(/\b(serves as|stands as|represents a|boasts|features)\b/i),
  },
  {
    id: 'dash-overuse',
    label: 'Dash used as a connector',
    severity: 'medium',
    advice: 'Use a period, comma, colon, or parentheses. Keep dashes only if the voice sample uses them.',
    detect: dashDetector,
  },
  {
    id: 'bold-decoration',
    label: 'Decorative bold',
    severity: 'medium',
    advice: 'Remove bold used for decoration.',
    detect: boldDetector,
  },
  {
    id: 'emoji-decoration',
    label: 'Emoji decoration',
    severity: 'medium',
    advice: 'Remove emojis from prose and headings.',
    detect: patternDetector(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u),
  },
  {
    id: 'stacked-qualifiers',
    label: 'Stacked qualifiers',
    severity: 'medium',
    advice: 'Keep only qualifiers the meaning needs.',
    detect: patternDetector(/\b(could potentially|might possibly|possibly be argued|might arguably|in some cases it may)\b/i),
  },
  {
    id: 'formulaic-saying',
    label: 'Formulaic saying',
    severity: 'medium',
    advice: 'Replace the saying with the specific claim.',
    detect: patternDetector(/\b(is the language of|is the currency of|becomes a trap|is not a (tool|feature) but a|the architecture of|the anatomy of)\b/i),
  },
  {
    id: 'filler',
    label: 'Filler phrase',
    severity: 'low',
    advice: 'Cut the filler.',
    detect: patternDetector(/\b(in order to|due to the fact that|at this point in time|in the event that|has the ability to|it is important to note that)\b/i),
  },
  {
    id: 'title-case-heading',
    label: 'Title-case heading',
    severity: 'low',
    advice: 'Use sentence case.',
    detect: patternDetector(/^#{1,6}\s+([A-Z][a-z]+\s+){2,}[A-Z][a-z]+/m),
  },
  {
    id: 'curly-quotes',
    label: 'Curly quotation marks',
    severity: 'low',
    advice: 'Use straight quotes.',
    detect: patternDetector(/[“”]/),
  },
  {
    id: 'hyphen-after-copula',
    label: 'Hyphenated pair after the noun',
    severity: 'low',
    advice: 'Drop the hyphen after the noun.',
    detect: patternDetector(/\b(is|are|was|were)\s+\w+-(quality|driven|known|facing|term|time|party|functional|focused)\b/i),
  },
  {
    id: 'repeated-opening',
    label: 'Repeated sentence openings',
    severity: 'low',
    advice: 'Merge the sentences or change the subject.',
    detect: repeatedOpeningDetector,
  },
  {
    id: 'dramatic-fragments',
    label: 'Row of dramatic fragments',
    severity: 'low',
    advice: 'Merge the fragments into a specific claim.',
    detect: fragmentDetector,
  },
]
