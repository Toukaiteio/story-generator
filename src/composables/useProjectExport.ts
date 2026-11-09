import { useToast } from '@/composables/useToast'
import {
  buildProjectFileName,
  exportProject,
  exportProjectEpub,
  serializeProjectFile,
  type ExportFormat,
} from '@/app'
import type { StoryProject } from '@/types/project'

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; extension: string }> = [
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'json', label: 'JSON', extension: 'json' },
  { id: 'plaintext', label: 'Plain text', extension: 'txt' },
  { id: 'epub', label: 'EPUB', extension: 'epub' },
]

function downloadFile(filename: string, content: string | Uint8Array, mime: string) {
  const blob = content instanceof Uint8Array
    ? new Blob([new Uint8Array(content)], { type: mime })
    : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function saveFile(defaultPath: string, content: string | Uint8Array, mime: string, extension: string) {
  const api = window.electronAPI
  const savedPath = await api?.dialog?.saveFile?.({
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })

  if (savedPath && api?.file?.write) {
    if (content instanceof Uint8Array) {
      const base64 = btoa(String.fromCharCode(...content))
      await api.file.writeBinary(savedPath, base64)
    } else {
      await api.file.write(savedPath, content)
    }
    return
  }

  downloadFile(defaultPath, content, mime)
}

export function useProjectExport() {
  const toast = useToast()

  async function exportFormat(project: StoryProject, format: ExportFormat) {
    if (format === 'epub') {
      const { data, filename } = await exportProjectEpub(project)
      await saveFile(filename, data, 'application/epub+zip', 'epub')
      toast.success(`Exported "${project.name}" as EPUB`)
      return
    }

    const { content, filename, extension } = exportProject(project, format)
    const mime = format === 'json'
      ? 'application/json'
      : format === 'markdown'
        ? 'text/markdown'
        : 'text/plain'
    await saveFile(filename, content, mime, extension.replace('.', ''))
    toast.success(`Exported "${project.name}" as ${format}`)
  }

  async function exportProjectFile(project: StoryProject) {
    await saveFile(buildProjectFileName(project), serializeProjectFile(project), 'application/json', 'json')
    toast.success(`Exported "${project.name}"`)
  }

  return { exportFormat, exportProjectFile }
}
