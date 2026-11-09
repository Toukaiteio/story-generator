import { markText, type MarkDictionary } from '@/app'
import type { InlineDiffLayout } from '@/app'

const MARK_CLASS = 'element-mark'

export interface EditorSelection {
  start: number
  end: number
}

function blockText(block: Node): string {
  return block.textContent ?? ''
}

/** Direct text nodes appear after select-all typing; they count as paragraphs. */
function editorBlocks(root: HTMLElement): Node[] {
  return Array.from(root.childNodes).filter(node =>
    node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent)),
  )
}

export function readEditorText(root: HTMLElement): string {
  return editorBlocks(root).map(blockText).join('\n')
}

function blockStartOffset(blocks: Node[], blockIndex: number): number {
  let offset = 0
  for (let index = 0; index < blockIndex; index++) {
    offset += blockText(blocks[index]).length + 1
  }
  return offset
}

function offsetWithinBlock(block: Node, container: Node, containerOffset: number): number {
  if (block.nodeType === Node.TEXT_NODE) {
    return container === block ? containerOffset : blockText(block).length
  }
  let total = 0
  let found = false

  const visit = (node: Node) => {
    if (found) return
    if (node === container) {
      if (container.nodeType === Node.TEXT_NODE) {
        total += containerOffset
      } else {
        for (let index = 0; index < containerOffset; index++) {
          total += node.childNodes[index]?.textContent?.length ?? 0
        }
      }
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length ?? 0
      return
    }
    node.childNodes.forEach(visit)
  }

  visit(block)
  return total
}

/** Plain-text offsets for the current DOM range, with paragraphs joined by \n. */
export function readSelectionOffsets(root: HTMLElement): EditorSelection | null {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const blocks = editorBlocks(root)
  const locate = (container: Node, offset: number): number => {
    if (container === root) {
      const blockIndex = Math.max(0, Math.min(offset, blocks.length - 1))
      return blockStartOffset(blocks, blockIndex)
    }
    let blockIndex = 0
    while (blockIndex < blocks.length && blocks[blockIndex] !== container && !blocks[blockIndex].contains(container)) {
      blockIndex += 1
    }
    if (blockIndex >= blocks.length) return 0
    return blockStartOffset(blocks, blockIndex) + offsetWithinBlock(blocks[blockIndex], container, offset)
  }

  return {
    start: locate(range.startContainer, range.startOffset),
    end: locate(range.endContainer, range.endOffset),
  }
}

function pointInBlock(block: Node, offset: number): { node: Node; offset: number } {
  if (block.nodeType === Node.TEXT_NODE) {
    return { node: block, offset: Math.min(offset, blockText(block).length) }
  }
  let remaining = offset
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
  }
  return { node: block, offset: block.childNodes.length }
}

function lastTextPosition(block: Node): { node: Node; offset: number } {
  return pointInBlock(block, blockText(block).length)
}

export function restoreSelectionOffsets(root: HTMLElement, selection: EditorSelection): void {
  const blocks = editorBlocks(root)
  if (!blocks.length) return

  const resolve = (offset: number): { node: Node; offset: number } => {
    let remaining = Math.max(0, offset)
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]
      const length = blockText(block).length
      if (remaining <= length || index === blocks.length - 1) {
        return pointInBlock(block, Math.min(remaining, length))
      }
      remaining -= length + 1
    }
    return lastTextPosition(blocks[blocks.length - 1])
  }

  const start = resolve(selection.start)
  const end = resolve(Math.max(selection.start, selection.end))
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const domSelection = window.getSelection()
  if (!domSelection) return
  domSelection.removeAllRanges()
  domSelection.addRange(range)
}

export function renderEditorContent(root: HTMLElement, text: string, dictionary: MarkDictionary): void {
  const fragment = document.createDocumentFragment()
  for (const line of text.split('\n')) {
    fragment.append(paragraphElement(line, dictionary))
  }
  root.replaceChildren(fragment)
}

function appendMarkedText(block: HTMLElement, text: string, dictionary: MarkDictionary): void {
  for (const segment of markText(text, dictionary)) {
    if (segment.type === 'text') {
      block.append(document.createTextNode(segment.text))
      continue
    }
    const mark = document.createElement('span')
    mark.className = MARK_CLASS
    mark.dataset.elementId = segment.elementId
    mark.dataset.alias = segment.isAlias ? 'true' : 'false'
    mark.tabIndex = 0
    mark.textContent = segment.text
    block.append(mark)
  }
}

function paragraphElement(line: string, dictionary: MarkDictionary): HTMLElement {
  const block = document.createElement('div')
  block.className = 'editor-paragraph'
  if (!line) {
    block.append(document.createElement('br'))
    return block
  }
  appendMarkedText(block, line, dictionary)
  return block
}

/** Renders a pending review in the prose flow: context stays prose, changes are inline marks. */
export function renderInlineDiff(root: HTMLElement, layout: InlineDiffLayout, dictionary: MarkDictionary): void {
  const fragment = document.createDocumentFragment()
  layout.paragraphs.forEach(paragraph => {
    const block = document.createElement('div')
    block.className = 'editor-paragraph'
    for (const run of paragraph.runs) {
      if (run.type === 'text') {
        appendMarkedText(block, run.text, dictionary)
        continue
      }
      const span = document.createElement('span')
      span.className = run.type === 'removed' ? 'inline-review-removed' : 'inline-review-added'
      span.dataset.inlineDiffRun = run.hunkId ?? ''
      span.textContent = run.text
      block.append(span)
    }
    if (!paragraph.runs.length) block.append(document.createElement('br'))
    if (paragraph.hunkIds.length) block.dataset.inlineDiffHunks = paragraph.hunkIds.join(' ')
    fragment.append(block)
  })
  root.replaceChildren(fragment)
}

export function closestMark(node: Node | null): HTMLElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const mark = element?.closest(`.${MARK_CLASS}`)
  return mark instanceof HTMLElement ? mark : null
}
