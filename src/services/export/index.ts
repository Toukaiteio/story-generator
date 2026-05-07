import type { StoryProject } from '@/types/project'
import { exportToMarkdown } from './markdown'
import { exportToJson } from './json'
import { exportToPlainText } from './plaintext'
import { exportToEpub } from './epub'

export type ExportFormat = 'markdown' | 'json' | 'plaintext' | 'epub'

const exporters: Record<ExportFormat, (project: StoryProject) => string> = {
  markdown: exportToMarkdown,
  json: exportToJson,
  plaintext: exportToPlainText,
  epub: () => '', // handled separately as binary
}

const fileExtensions: Record<ExportFormat, string> = {
  markdown: '.md',
  json: '.json',
  plaintext: '.txt',
  epub: '.epub',
}

export function exportProject(project: StoryProject, format: ExportFormat): { content: string; filename: string; extension: string } {
  if (format === 'epub') throw new Error('Use exportProjectEpub for EPUB format')
  const exporter = exporters[format]
  if (!exporter) throw new Error(`Unknown export format: ${format}`)

  return {
    content: exporter(project),
    filename: `${project.name.replace(/[^a-zA-Z0-9一-鿿]/g, '_')}${fileExtensions[format]}`,
    extension: fileExtensions[format],
  }
}

export async function exportProjectEpub(project: StoryProject): Promise<{ data: Uint8Array; filename: string }> {
  return {
    data: await exportToEpub(project),
    filename: `${project.name.replace(/[^a-zA-Z0-9一-鿿]/g, '_')}.epub`,
  }
}

export { exportToMarkdown, exportToJson, exportToPlainText, exportToEpub }
