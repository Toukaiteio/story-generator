import { markText, type MarkDictionary } from './marking'

/** Walk text nodes, skipping links and code, and wrap dictionary hits in marks. */
export function markPreviewHtml(html: string, dictionary: MarkDictionary): string {
  if (!dictionary.entries.length) return html
  const template = document.createElement('template')
  template.innerHTML = html

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent) continue
    if (parent.closest('a, code, pre')) continue
    if (parent.closest('.element-mark')) continue
    textNodes.push(node)
  }

  for (const node of textNodes) {
    const segments = markText(node.data, dictionary)
    if (!segments.some(segment => segment.type === 'mark')) continue
    const fragment = document.createDocumentFragment()
    for (const segment of segments) {
      if (segment.type === 'text') {
        fragment.append(document.createTextNode(segment.text))
        continue
      }
      const span = document.createElement('span')
      span.className = 'element-mark'
      span.tabIndex = 0
      span.dataset.elementId = segment.elementId
      span.dataset.alias = segment.isAlias ? 'true' : 'false'
      span.textContent = segment.text
      fragment.append(span)
    }
    node.replaceWith(fragment)
  }

  return template.innerHTML
}

