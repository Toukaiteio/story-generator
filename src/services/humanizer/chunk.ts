const DEFAULT_MAX_CHARS = 3200

/** Split prose into paragraph-aligned chunks small enough for one rewrite call. */
export function chunkForHumanize(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush()
      for (const piece of splitLongParagraph(paragraph, maxChars)) chunks.push(piece)
      continue
    }
    if (current && current.length + paragraph.length + 2 > maxChars) flush()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  flush()

  return chunks.length ? chunks : (text.trim() ? [text.trim()] : [])
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/)
  const pieces: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) { pieces.push(current); current = '' }
      for (let index = 0; index < sentence.length; index += maxChars) {
        pieces.push(sentence.slice(index, index + maxChars))
      }
      continue
    }
    if (current && current.length + sentence.length + 1 > maxChars) {
      pieces.push(current)
      current = ''
    }
    current = current ? `${current} ${sentence}` : sentence
  }
  if (current) pieces.push(current)
  return pieces
}
