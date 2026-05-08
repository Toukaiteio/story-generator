import type { WritingFormat } from '@/types/project'

const HAN_NUMERAL_CLASS = '\\u96f6\\u3007\\u4e00\\u4e8c\\u4e24\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343\\u4e07\\d'
const HAN_CHAPTER_UNIT_CLASS = '\\u7ae0\\u8282\\u56de\\u7bc7\\u90e8\\u5377\\u5e55'
const ENGLISH_CHAPTER_NUMERAL = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+'
const CHAPTER_PREFIX_RE = new RegExp(
  `^(?:\\u7b2c[${HAN_NUMERAL_CLASS}]+[${HAN_CHAPTER_UNIT_CLASS}]|chapter\\s+(?:${ENGLISH_CHAPTER_NUMERAL}))\\s*[:\\u\uff1a\\u3001.,\\-\\s]*`,
  'i'
)
const SECTION_HEADING_RE = new RegExp(
  `^\\s*(?:[${HAN_NUMERAL_CLASS}]+|\\d+|[ivxlcdm]+)\\s*[\\u3001.\\u\uff0e\\-)\\uff09]\\s*\\S.{0,40}$`,
  'i'
)
const STYLE_STRUCTURE_KEYWORDS = [
  'markdown',
  'heading',
  'headings',
  'subheading',
  'subheadings',
  'section title',
  'section titles',
  'section heading',
  'section headings',
  'chapter title',
  'chapter titles',
  'title line',
  'title lines',
  '\u6807\u9898',
  '\u5c0f\u6807\u9898',
  '\u5206\u8282',
  '\u5206\u7ae0',
  '\u7ae0\u8282\u6807\u9898',
  '\u7ae0\u6807\u9898',
  '\u8282\u6807\u9898',
]
const STYLE_STRUCTURE_NEGATION_RE = /(?:do not|don't|without|avoid|no|never|禁止|不要|避免|不使用|不能|不得).{0,32}(?:markdown|heading|title|section|标题|小标题|分节|分章)/i

function normalizeComparableText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#{1,6}\s*/, '')
    .replace(CHAPTER_PREFIX_RE, '')
    .replace(new RegExp("[*_`~#\"'\\u201c\\u201d\\u2018\\u2019\\u300a\\u300b\\u3008\\u3009]", 'g'), '')
    .replace(/\s+/g, '')
}

function stripCodeFenceLines(lines: string[]) {
  return lines.filter(line => !/^\s*```/.test(line))
}

function stripMarkdownForPlainText(content: string) {
  return stripCodeFenceLines(content.split(/\r?\n/))
    .filter(line => !/^\s{0,3}#{1,6}\s+/.test(line))
    .filter(line => !SECTION_HEADING_RE.test(line.trim()))
    .map(line => line
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    )
    .filter(line => !/^\s*(?:-{3,}|={3,})\s*$/.test(line))
    .join('\n')
}

export function writingStyleOverridesFormat(style?: string) {
  if (!style?.trim()) return false
  if (STYLE_STRUCTURE_NEGATION_RE.test(style)) return false

  const normalized = style.toLowerCase()
  return STYLE_STRUCTURE_KEYWORDS.some(keyword => normalized.includes(keyword))
    || /(^|\n)\s*#{1,6}\s+\S/.test(style)
}

function isChapterHeadingLine(line: string, title: string, chapterNumber: number) {
  const trimmed = line.trim()
  if (!trimmed) return false

  const unmarked = trimmed
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .trim()
  const titleKey = normalizeComparableText(title)
  const lineKey = normalizeComparableText(unmarked)
  if (titleKey && lineKey === titleKey) return true

  if (!CHAPTER_PREFIX_RE.test(unmarked)) return false

  return true
}

function removeLeadingChapterHeading(content: string, title: string, chapterNumber: number) {
  if (!title.trim() && !Number.isInteger(chapterNumber)) return content.trim()

  const lines = content.trim().split(/\r?\n/)
  let checkedNonEmpty = 0
  const kept: string[] = []

  for (const line of lines) {
    if (!line.trim()) {
      kept.push(line)
      continue
    }

    checkedNonEmpty += 1
    if (checkedNonEmpty <= 3 && isChapterHeadingLine(line, title, chapterNumber)) {
      continue
    }
    kept.push(line)
  }

  return kept.join('\n').trim()
}

export function sanitizeGeneratedChapterContent(
  content: string,
  options: {
    writingFormat?: WritingFormat
    chapterTitle?: string
    chapterNumber?: number
    writingStyle?: string
  } = {}
) {
  const writingFormat = options.writingFormat === 'markdown' ? 'markdown' : 'plaintext'
  const chapterTitle = options.chapterTitle ?? ''
  const chapterNumber = Number.isInteger(options.chapterNumber) ? options.chapterNumber! : 0
  const styleOverridesFormat = writingStyleOverridesFormat(options.writingStyle)
  const withoutTitle = styleOverridesFormat
    ? content.trim()
    : removeLeadingChapterHeading(content, chapterTitle, chapterNumber)

  if (writingFormat === 'markdown' || styleOverridesFormat) {
    return withoutTitle.trim()
  }

  return stripMarkdownForPlainText(withoutTitle).trim()
}

export function buildWritingFormatInstruction(writingFormat?: WritingFormat, writingStyle?: string) {
  const priority = writingStyleOverridesFormat(writingStyle)
    ? 'Priority: the Writing Style Guide explicitly requests structure/formatting, so it overrides Writing Format when they conflict.'
    : 'Priority: Writing Style Guide has higher priority than Writing Format. If they conflict, follow the Writing Style Guide.'

  if (writingFormat === 'markdown') {
    return [
      priority,
      'Output format: Markdown.',
      'Do not include a top-level chapter title or chapter number; the editor already displays it.',
      'Use Markdown only for intentional structure inside the chapter.',
    ].join('\n')
  }

  return [
    priority,
    'Output format: Plain Text.',
    'Unless the Writing Style Guide explicitly requires otherwise, do not use Markdown syntax such as #, ##, **bold**, blockquotes, bullet lists, or code fences.',
    'Unless the Writing Style Guide explicitly requires otherwise, do not include a chapter title, chapter number, table of contents, section headings, or labels.',
    'Start directly with the chapter prose.',
  ].join('\n')
}
