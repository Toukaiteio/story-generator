export function stripCodeFence(content: string) {
  const trimmed = content.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export function extractJsonObject(content: string) {
  const stripped = stripCodeFence(content)
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Response does not contain a valid JSON object')
  }
  return stripped.slice(start, end + 1)
}

export function extractJsonPayload(content: string) {
  const stripped = stripCodeFence(content)
  const objectStart = stripped.indexOf('{')
  const objectEnd = stripped.lastIndexOf('}')
  const arrayStart = stripped.indexOf('[')
  const arrayEnd = stripped.lastIndexOf(']')

  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart && (objectStart === -1 || arrayStart < objectStart)) {
    return stripped.slice(arrayStart, arrayEnd + 1)
  }

  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1)
  }

  throw new Error('Response does not contain a valid JSON payload')
}

export function countWords(content: string) {
  return content
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length
}

export function countParagraphs(content: string) {
  return content
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .length
}

export function containsMetaCommentary(content: string) {
  return /(\bAs an AI\b|\bI can(?:not|'t)\b|\bHere(?:'s| is) the (?:result|response)\b|```)/i.test(content)
}

export function containsChapterBreakdown(content: string) {
  return /(?:chapter\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|[ivxlcdm]+|\d+)|第\s*[0-9一二三四五六七八九十百千]+\s*(?:章|节))/i.test(content)
}
