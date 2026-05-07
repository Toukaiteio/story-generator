<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { BookOpen, FileDown, FileText, MoreVertical, Plus, RefreshCw, Search, Save, Trash2, Upload } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { useToast } from '@/composables/useToast'
import { buildKnowledgeBaseFileName, parseKnowledgeBaseFile, serializeKnowledgeBaseFile } from '@/services/knowledge/file'
import { convertKnowledgeDocumentToMarkdown } from '@/services/knowledge/convert'
import { decodeProviderModelRef, encodeProviderModelRef } from '@/services/provider/catalog'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

type DeleteTarget =
  | { type: 'base'; id: string }
  | { type: 'document'; id: string }

const ui = useUiStore()
const knowledgeStore = useKnowledgeStore()
const providerStore = useProviderStore()
const toast = useToast()

const searchQuery = ref('')
const showBaseDrawer = ref(false)
const showTextDrawer = ref(false)
const showDeleteConfirm = ref(false)
const deleteTarget = ref<DeleteTarget | null>(null)
const editingBaseId = ref<string | null>(null)
const selectedDocumentId = ref<string | null>(null)
const baseImportInputRef = ref<HTMLInputElement | null>(null)
const documentImportInputRef = ref<HTMLInputElement | null>(null)

const baseForm = reactive({
  name: '',
  description: '',
  mode: 'keyword' as 'keyword' | 'vector' | 'hybrid',
  embeddingRef: '',
})

const textForm = reactive({
  name: '',
  content: '',
})

const documentForm = reactive({
  name: '',
  content: '',
})

const activeBase = computed(() => knowledgeStore.activeKnowledgeBase)
const documentList = computed(() => activeBase.value?.documents ?? [])
const defaultEmbeddingModelRef = computed(() => providerStore.getEmbeddingModelBinding())
const knowledgeModeOptions = [
  { label: 'Keyword', value: 'keyword' },
  { label: 'Vector', value: 'vector' },
  { label: 'Hybrid', value: 'hybrid' },
]
const embeddingModelOptions = computed(() =>
  providerStore.modelOptions
    .filter(option => option.supportsEmbeddings)
    .map(option => ({
      label: option.label,
      value: option.value,
    }))
)

const filteredDocuments = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return documentList.value

  return documentList.value.filter(doc =>
    [doc.name, doc.sourceName ?? '', doc.fileType ?? '', doc.content]
      .some(value => value.toLowerCase().includes(query))
  )
})

const selectedDocument = computed(() =>
  documentList.value.find(doc => doc.id === selectedDocumentId.value) ?? null
)

const searchMatches = computed(() => {
  const query = searchQuery.value.trim()
  if (!query || !activeBase.value) return []
  return knowledgeStore.searchResults
})

const baseDialogTitle = computed(() => editingBaseId.value ? 'Edit Knowledge Base' : 'New Knowledge Base')
const baseDialogConfirm = computed(() => editingBaseId.value ? 'Save' : 'Create')
const deleteDialogTitle = computed(() => deleteTarget.value?.type === 'document' ? 'Delete Document' : 'Delete Knowledge Base')
const deleteDialogMessage = computed(() => {
  if (deleteTarget.value?.type === 'document') {
    return 'This will permanently delete the selected document from the knowledge base.'
  }
  return 'This will permanently delete the selected knowledge base and all of its documents. This action cannot be undone.'
})

function formatDate(value: string) {
  const date = new Date(value)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '')
}

function getFileExtension(fileName: string) {
  const parts = fileName.split('.')
  return (parts.length > 1 ? parts.pop() : '')?.toLowerCase() || ''
}

function decodeBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function syncBaseForm(base = activeBase.value) {
  baseForm.name = base?.name ?? ''
  baseForm.description = base?.description ?? ''
  baseForm.mode = base?.mode ?? 'keyword'
  baseForm.embeddingRef = base?.embedding.providerModelRef
    ? encodeProviderModelRef(base.embedding.providerModelRef)
    : (base?.mode === 'vector' || base?.mode === 'hybrid') && defaultEmbeddingModelRef.value
      ? encodeProviderModelRef(defaultEmbeddingModelRef.value)
    : ''
}

function syncDocumentForm(document = selectedDocument.value) {
  documentForm.name = document?.name ?? ''
  documentForm.content = document?.content ?? ''
}

async function refreshSearchResults() {
  const query = searchQuery.value.trim()
  if (!activeBase.value || !query) {
    knowledgeStore.search('', '')
    return
  }

  await knowledgeStore.searchAsync(activeBase.value.id, query)
}

watch(activeBase, (base) => {
  syncBaseForm(base ?? undefined)

  if (!base) {
    selectedDocumentId.value = null
    syncDocumentForm(null)
    refreshSearchResults()
    return
  }

  if (!base.documents.some(doc => doc.id === selectedDocumentId.value)) {
    selectedDocumentId.value = base.documents[0]?.id ?? null
  }

  if (!base.documents.length) {
    selectedDocumentId.value = null
  }

  refreshSearchResults()
}, { immediate: true })

watch(selectedDocument, (document) => {
  syncDocumentForm(document ?? undefined)
}, { immediate: true })

watch(searchQuery, () => { void refreshSearchResults() })

function openCreateBaseDrawer() {
  editingBaseId.value = null
  syncBaseForm(null)
  showBaseDrawer.value = true
}

function openEditBaseDrawer(baseId: string) {
  const base = knowledgeStore.getKnowledgeBaseById(baseId)
  if (!base) return
  editingBaseId.value = base.id
  syncBaseForm(base)
  showBaseDrawer.value = true
}

function saveBase() {
  const name = baseForm.name.trim()
  if (!name) {
    toast.error('Knowledge base name is required')
    return
  }

  let embeddingRef = baseForm.embeddingRef ? decodeProviderModelRef(baseForm.embeddingRef) : null
  if ((baseForm.mode === 'vector' || baseForm.mode === 'hybrid') && !embeddingRef) {
    embeddingRef = defaultEmbeddingModelRef.value
  }
  if ((baseForm.mode === 'vector' || baseForm.mode === 'hybrid') && !embeddingRef) {
    toast.error('Vector mode requires an embedding model')
    return
  }

  // Look up embedding dimensions from the selected model
  let dimensions: number | null = null
  if (embeddingRef) {
    const match = providerStore.getModelByRef(embeddingRef)
    dimensions = match?.model.embeddingDimensions ?? null
  }

  if (editingBaseId.value) {
    const updated = knowledgeStore.updateKnowledgeBase(editingBaseId.value, {
      name,
      description: baseForm.description.trim(),
      mode: baseForm.mode,
      embedding: { providerModelRef: embeddingRef, dimensions },
    })
    if (updated) {
      toast.success(`Knowledge base "${updated.name}" updated`)
      knowledgeStore.setActiveKnowledgeBase(updated.id)
      if (updated.mode !== 'keyword' && updated.embedding.providerModelRef) {
        void knowledgeStore.reindexKnowledgeBase(updated.id)
      }
    }
  } else {
    const created = knowledgeStore.createKnowledgeBase(name, baseForm.description.trim())
    knowledgeStore.updateKnowledgeBase(created.id, {
      mode: baseForm.mode,
      embedding: { providerModelRef: embeddingRef, dimensions },
    })
    toast.success(`Knowledge base "${created.name}" created`)
    knowledgeStore.setActiveKnowledgeBase(created.id)
    if (baseForm.mode !== 'keyword' && embeddingRef) {
      void knowledgeStore.reindexKnowledgeBase(created.id)
    }
  }

  showBaseDrawer.value = false
  editingBaseId.value = null
}

function reindexActiveBase() {
  if (!activeBase.value) return
  if (activeBase.value.mode === 'keyword') {
    toast.warning('Keyword mode does not require reindexing')
    return
  }
  if (!activeBase.value.embedding.providerModelRef) {
    toast.warning('Select an embedding model first')
    return
  }
  void knowledgeStore.reindexKnowledgeBase(activeBase.value.id)
    .then(() => toast.success('Knowledge base reindexed'))
    .catch((error: any) => toast.error(error?.message || 'Failed to reindex'))
}

function handleBaseSelect(baseId: string) {
  knowledgeStore.setActiveKnowledgeBase(baseId)
  selectedDocumentId.value = null
}

function openDeleteBaseConfirm(baseId: string) {
  deleteTarget.value = { type: 'base', id: baseId }
  showDeleteConfirm.value = true
}

function openDeleteDocumentConfirm(documentId: string) {
  deleteTarget.value = { type: 'document', id: documentId }
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return

  if (target.type === 'base') {
    const base = knowledgeStore.getKnowledgeBaseById(target.id)
    await knowledgeStore.removeKnowledgeBase(target.id)
    toast.success(`Knowledge base "${base?.name ?? 'Untitled'}" deleted`)
    selectedDocumentId.value = null
  } else {
    const base = activeBase.value
    const document = base?.documents.find(doc => doc.id === target.id)
    knowledgeStore.removeDocument(base?.id ?? '', target.id)
    toast.success(`Document "${document?.name ?? 'Untitled'}" deleted`)
    if (selectedDocumentId.value === target.id) {
      selectedDocumentId.value = base?.documents.find(doc => doc.id !== target.id)?.id ?? null
    }
    refreshSearchResults()
  }

  deleteTarget.value = null
  showDeleteConfirm.value = false
}

function cancelDelete() {
  deleteTarget.value = null
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function exportKnowledgeBase(baseId: string) {
  const base = knowledgeStore.getKnowledgeBaseById(baseId)
  if (!base) return

  const filename = buildKnowledgeBaseFileName(base)
  const content = serializeKnowledgeBaseFile(base)

  const savedPath = await window.electronAPI?.dialog?.saveFile?.({
    defaultPath: filename,
    filters: [{ name: 'Knowledge Base File', extensions: ['json'] }],
  })

  if (savedPath && window.electronAPI?.file?.write) {
    await window.electronAPI.file.write(savedPath, content)
    toast.success(`Exported "${base.name}"`)
    return
  }

  if (savedPath === null || savedPath === undefined) {
    return
  }

  downloadTextFile(filename, content)
  toast.success(`Exported "${base.name}"`)
}

async function handleImportBaseFileContent(content: string) {
  const raw = parseKnowledgeBaseFile(content)
  const kb = knowledgeStore.importKnowledgeBase(raw)
  toast.success(`Imported knowledge base "${kb.name}"`)
  knowledgeStore.setActiveKnowledgeBase(kb.id)
}

function openImportBaseDialog() {
  if (window.electronAPI?.dialog?.openFile) {
    void handleImportBaseFile()
    return
  }
  baseImportInputRef.value?.click()
}

async function handleImportBaseFile() {
  if (window.electronAPI?.dialog?.openFile && window.electronAPI?.file?.read) {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [{ name: 'Knowledge Base File', extensions: ['json'] }],
    })
    if (!filePath) return
    const content = await window.electronAPI.file.read(filePath)
    if (!content) throw new Error('Unable to read knowledge base file')
    await handleImportBaseFileContent(content)
    return
  }

  const input = baseImportInputRef.value
  const file = input?.files?.[0]
  if (!file) return
  const content = await file.text()
  if (input) input.value = ''
  await handleImportBaseFileContent(content)
}

function openAddTextDrawer() {
  if (!activeBase.value) {
    toast.warning('Create or select a knowledge base first')
    return
  }
  textForm.name = ''
  textForm.content = ''
  showTextDrawer.value = true
}

function saveTextDocument() {
  if (!activeBase.value) return
  const name = textForm.name.trim()
  const content = textForm.content.trim()
  if (!name || !content) {
    toast.error('Document name and content are required')
    return
  }

  const doc = knowledgeStore.addDocument(activeBase.value.id, name, content, 'manual')
  if (!doc) {
    toast.error('Failed to add document')
    return
  }

  selectedDocumentId.value = doc.id
  showTextDrawer.value = false
  toast.success(`Document "${doc.name}" added`)
  refreshSearchResults()
}

function openDocumentImportDialog() {
  if (!activeBase.value) {
    toast.warning('Create or select a knowledge base first')
    return
  }

  if (window.electronAPI?.dialog?.openFiles) {
    void handleDocumentImportFiles()
    return
  }

  documentImportInputRef.value?.click()
}

async function importDocumentFromBytes(fileName: string, bytes: Uint8Array | ArrayBuffer) {
  if (!activeBase.value) return

  const extension = getFileExtension(fileName)
  const result = await convertKnowledgeDocumentToMarkdown({
    fileName,
    extension,
    bytes,
  })

  const markdown = result.markdown.trim()
  if (!markdown) {
    throw new Error(`"${fileName}" produced no usable content`)
  }

  const docName = stripExtension(fileName) || 'Imported Document'
  const doc = knowledgeStore.addDocument(activeBase.value.id, docName, markdown, 'upload', {
    fileType: extension,
    sourceName: fileName,
  })

  if (!doc) {
    throw new Error(`Failed to import "${fileName}"`)
  }

  selectedDocumentId.value = doc.id
  if (result.warnings.length) {
    toast.warning(result.warnings.join('; '))
  }
  refreshSearchResults()
}

async function handleDocumentImportFiles() {
  if (!activeBase.value) return

  if (window.electronAPI?.dialog?.openFiles && window.electronAPI?.file?.readBinary) {
    const filePaths = await window.electronAPI.dialog.openFiles({
      filters: [
        { name: 'Documents', extensions: ['txt', 'md', 'markdown', 'html', 'htm', 'rtf', 'doc', 'docx'] },
      ],
    })
    if (!filePaths?.length) return

    for (const filePath of filePaths) {
      const fileName = filePath.split(/[\\/]/).pop() || filePath
      const base64 = await window.electronAPI.file.readBinary(filePath)
      if (!base64) continue
      await importDocumentFromBytes(fileName, decodeBase64(base64))
    }
    return
  }

  const input = documentImportInputRef.value
  const files = Array.from(input?.files ?? [])
  if (!files.length) return

  for (const file of files) {
    await importDocumentFromBytes(file.name, await file.arrayBuffer())
  }

  if (input) input.value = ''
}

function saveSelectedDocument() {
  if (!activeBase.value || !selectedDocument.value) return

  const updated = knowledgeStore.updateDocument(activeBase.value.id, selectedDocument.value.id, {
    name: documentForm.name.trim(),
    content: documentForm.content,
  })

  if (!updated) {
    toast.error('Failed to save document')
    return
  }

  refreshSearchResults()
  toast.success(`Document "${updated.name}" saved`)
}

function deleteSelectedDocument() {
  if (!activeBase.value || !selectedDocument.value) return
  openDeleteDocumentConfirm(selectedDocument.value.id)
}

function getBaseDropdownItems(baseId: string) {
  return [
    { label: 'Edit', icon: FileText, action: () => openEditBaseDrawer(baseId) },
    { label: 'Export', icon: FileDown, action: () => exportKnowledgeBase(baseId) },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, action: () => openDeleteBaseConfirm(baseId) },
  ]
}

function selectDocument(documentId: string) {
  selectedDocumentId.value = documentId
}

function handleBaseImportInputChange() {
  void handleImportBaseFile()
}

function handleDocumentImportInputChange() {
  void handleDocumentImportFiles()
}

onMounted(() => ui.navigateTo('knowledge'))

watch(
  () => providerStore.providers,
  (providers) => {
    providerManager.setProviders(providers)
  },
  { deep: true, immediate: true }
)
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-surface-4 shrink-0">
      <div>
        <h1 class="text-lg font-semibold text-text-primary">Knowledge Base</h1>
        <p class="text-xs text-text-secondary mt-0.5">Manage reference material, import documents, and reuse it in generation.</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="secondary" size="sm" @click="openImportBaseDialog">
          <Upload :size="14" />
          <span>Import Base</span>
        </BaseButton>
        <BaseButton variant="secondary" size="sm" @click="openDocumentImportDialog">
          <FileText :size="14" />
          <span>Upload Docs</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="openCreateBaseDrawer">
          <Plus :size="14" />
          <span>New Base</span>
        </BaseButton>
      </div>
    </div>

    <div class="flex-1 min-h-0 grid grid-cols-[280px_minmax(0,1fr)] gap-4 p-6">
      <aside class="min-h-0 rounded-lg border border-surface-4 bg-surface-2 flex flex-col overflow-hidden">
        <div class="px-4 py-3 border-b border-surface-4 flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-text-primary">Knowledge Bases</p>
            <p class="text-xs text-text-secondary">{{ knowledgeStore.sortedKnowledgeBases.length }} total</p>
          </div>
          <BaseButton variant="ghost" size="sm" @click="openCreateBaseDrawer">
            <Plus :size="14" />
            <span>New</span>
          </BaseButton>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-2">
          <button
            v-for="base in knowledgeStore.sortedKnowledgeBases"
            :key="base.id"
            class="w-full rounded-lg border p-3 text-left transition-colors duration-100"
            :class="activeBase?.id === base.id ? 'border-accent bg-accent-subtle' : 'border-surface-4 bg-surface-1 hover:border-surface-5'"
            @click="handleBaseSelect(base.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-text-primary truncate">{{ base.name }}</div>
                <div class="text-2xs text-text-secondary mt-0.5 line-clamp-2">{{ base.description || 'No description' }}</div>
              </div>
              <div class="flex items-center gap-1 shrink-0" @click.stop>
                <BaseDropdown :items="getBaseDropdownItems(base.id)">
                  <template #trigger>
                    <div class="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-surface-4">
                      <MoreVertical :size="14" />
                    </div>
                  </template>
                </BaseDropdown>
              </div>
            </div>
            <div class="flex items-center gap-2 mt-3">
              <BaseTag size="sm">{{ base.documents.length }} docs</BaseTag>
              <BaseTag size="sm">{{ formatDate(base.updatedAt) }}</BaseTag>
            </div>
          </button>

          <EmptyState
            v-if="!knowledgeStore.sortedKnowledgeBases.length"
            :icon="BookOpen"
            title="No knowledge bases yet"
            description="Create a base, import a bundle, or upload documents to start building reference material."
          >
            <template #action>
              <BaseButton variant="primary" size="sm" @click="openCreateBaseDrawer">
                <Plus :size="14" />
                <span>Create Base</span>
              </BaseButton>
            </template>
          </EmptyState>
        </div>
      </aside>

      <main class="min-h-0 flex flex-col gap-4">
        <section v-if="activeBase" class="rounded-lg border border-surface-4 bg-surface-2 p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-base font-semibold text-text-primary truncate">{{ activeBase.name }}</h2>
                <BaseTag size="sm">{{ activeBase.documents.length }} docs</BaseTag>
                <BaseTag size="sm">{{ activeBase.mode }}</BaseTag>
              </div>
              <p class="text-xs text-text-secondary mt-1">
                Updated {{ formatDate(activeBase.updatedAt) }}
              </p>
              <p class="text-xs text-text-secondary mt-1">
                {{ activeBase.indexingStatus === 'ready' ? 'Indexed' : activeBase.indexingStatus === 'indexing' ? 'Indexing' : activeBase.mode === 'keyword' ? 'Keyword only' : 'Needs indexing' }}
                <span v-if="activeBase.lastIndexedAt"> · Last indexed {{ formatDate(activeBase.lastIndexedAt) }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <BaseButton v-if="activeBase.mode !== 'keyword'" variant="secondary" size="sm" @click="reindexActiveBase">
                <RefreshCw :size="14" />
                <span>Reindex</span>
              </BaseButton>
              <BaseButton variant="secondary" size="sm" @click="openDocumentImportDialog">
                <Upload :size="14" />
                <span>Upload</span>
              </BaseButton>
              <BaseButton variant="secondary" size="sm" @click="openAddTextDrawer">
                <Plus :size="14" />
                <span>Add Text</span>
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="openEditBaseDrawer(activeBase.id)">
                <FileText :size="14" />
                <span>Edit</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="exportKnowledgeBase(activeBase.id)">
                <FileDown :size="14" />
                <span>Export</span>
              </BaseButton>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <BaseInput v-model="baseForm.name" label="Base Name" />
            <BaseTextarea
              v-model="baseForm.description"
              label="Description"
              :rows="3"
              :auto-resize="true"
            />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <BaseSelect v-model="baseForm.mode" label="Mode" :options="knowledgeModeOptions" />
            <BaseSelect
              v-model="baseForm.embeddingRef"
              label="Embedding Model"
              :options="embeddingModelOptions"
              :disabled="baseForm.mode === 'keyword'"
              placeholder="Choose an embedding model"
            />
          </div>
          <p class="text-xs text-text-secondary mt-2">
            Keyword mode uses the built-in text search. Vector and hybrid modes require an embedding model and reindexing.
          </p>

          <div class="mt-4 flex justify-end">
            <BaseButton variant="primary" size="sm" @click="saveBase">
              <Save :size="14" />
              <span>Save Base</span>
            </BaseButton>
          </div>
        </section>

        <section v-if="activeBase" class="flex-1 min-h-0 grid grid-cols-[320px_minmax(0,1fr)] gap-4">
          <div class="min-h-0 rounded-lg border border-surface-4 bg-surface-2 flex flex-col overflow-hidden">
            <div class="px-4 py-3 border-b border-surface-4">
              <BaseInput v-model="searchQuery" placeholder="Search documents..." :icon="Search" />
            </div>

            <div class="flex-1 overflow-y-auto p-3 space-y-2">
              <button
                v-for="doc in filteredDocuments"
                :key="doc.id"
                class="w-full rounded-lg border p-3 text-left transition-colors duration-100"
                :class="selectedDocumentId === doc.id ? 'border-accent bg-accent-subtle' : 'border-surface-4 bg-surface-1 hover:border-surface-5'"
                @click="selectDocument(doc.id)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-text-primary truncate">{{ doc.name }}</div>
                    <div class="text-2xs text-text-secondary mt-0.5 line-clamp-2">
                      {{ doc.sourceName || doc.fileType || (doc.source === 'manual' ? 'Manual entry' : 'Uploaded document') }}
                    </div>
                  </div>
                  <div class="shrink-0">
                    <BaseTag size="sm">{{ doc.source }}</BaseTag>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 mt-3 flex-wrap">
                  <BaseTag v-if="doc.fileType" size="sm">{{ doc.fileType }}</BaseTag>
                  <BaseTag size="sm">{{ doc.chunks.length }} chunks</BaseTag>
                  <BaseTag size="sm">{{ formatDate(doc.updatedAt) }}</BaseTag>
                </div>
              </button>

              <EmptyState
                v-if="!filteredDocuments.length"
                :icon="FileText"
                title="No documents"
                :description="searchQuery.trim() ? 'No documents matched your search.' : 'Upload files or add text to populate this knowledge base.'"
              />
            </div>

            <div v-if="searchQuery.trim() && searchMatches.length" class="border-t border-surface-4 p-3 space-y-2">
              <p class="text-xs font-medium text-text-secondary uppercase tracking-wider">Content Matches</p>
              <div class="space-y-2 max-h-48 overflow-y-auto">
                <div
                  v-for="result in searchMatches.slice(0, 5)"
                  :key="result.chunk.id"
                  class="rounded-md border border-surface-4 bg-surface-1 p-2"
                >
                  <div class="text-2xs font-medium text-text-secondary mb-1">Score {{ result.score }}</div>
                  <div class="text-xs text-text-primary line-clamp-4 whitespace-pre-wrap">{{ result.highlight }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="min-h-0 rounded-lg border border-surface-4 bg-surface-2 p-4 overflow-y-auto">
            <template v-if="selectedDocument">
              <div class="flex items-start justify-between gap-4 mb-4">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-text-primary truncate">{{ selectedDocument.name }}</h3>
                  <div class="flex items-center gap-2 mt-2 flex-wrap">
                    <BaseTag size="sm">{{ selectedDocument.source }}</BaseTag>
                    <BaseTag v-if="selectedDocument.fileType" size="sm">{{ selectedDocument.fileType }}</BaseTag>
                    <BaseTag v-if="selectedDocument.sourceName" size="sm">{{ selectedDocument.sourceName }}</BaseTag>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <BaseButton variant="danger" size="sm" @click="deleteSelectedDocument">
                    <Trash2 :size="14" />
                    <span>Delete</span>
                  </BaseButton>
                  <BaseButton variant="primary" size="sm" @click="saveSelectedDocument">
                    <Save :size="14" />
                    <span>Save</span>
                  </BaseButton>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BaseInput v-model="documentForm.name" label="Document Name" />
                <div class="rounded-md border border-surface-4 bg-surface-1 px-3 py-2">
                  <p class="text-xs font-medium text-text-secondary">Content Format</p>
                  <p class="text-sm text-text-primary mt-1">Stored as markdown text inside the knowledge base</p>
                </div>
              </div>

              <BaseTextarea
                v-model="documentForm.content"
                class="mt-4"
                label="Markdown Content"
                :rows="22"
                :auto-resize="true"
              />
            </template>

            <EmptyState
              v-else
              :icon="FileText"
              title="Select a document"
              description="Pick a document to inspect or edit its markdown content."
            />
          </div>
        </section>

        <EmptyState
          v-else
          :icon="BookOpen"
          title="Select or create a knowledge base"
          description="Knowledge bases hold the documents used as generation reference material."
        />
      </main>
    </div>

    <Transition name="backdrop">
      <div
        v-if="showBaseDrawer"
        class="fixed inset-0 z-[120] bg-black/60"
        @mousedown.self="showBaseDrawer = false"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showBaseDrawer"
            class="absolute right-0 top-0 h-full w-[420px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">{{ baseDialogTitle }}</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showBaseDrawer = false"
              >
                <FileText :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              <BaseInput v-model="baseForm.name" label="Base Name" placeholder="e.g., Worldbuilding Notes" />
              <BaseTextarea
                v-model="baseForm.description"
                label="Description"
                placeholder="Describe what this knowledge base contains..."
                :rows="10"
                :auto-resize="true"
              />
            </div>
            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showBaseDrawer = false">Cancel</BaseButton>
              <BaseButton variant="primary" size="sm" @click="saveBase">
                {{ baseDialogConfirm }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <Transition name="backdrop">
      <div
        v-if="showTextDrawer"
        class="fixed inset-0 z-[120] bg-black/60"
        @mousedown.self="showTextDrawer = false"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showTextDrawer"
            class="absolute right-0 top-0 h-full w-[420px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">Add Text Entry</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showTextDrawer = false"
              >
                <FileText :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              <BaseInput v-model="textForm.name" label="Entry Name" placeholder="e.g., World History" />
              <BaseTextarea
                v-model="textForm.content"
                label="Content"
                placeholder="Paste or type your reference content here..."
                :rows="12"
                :auto-resize="true"
              />
            </div>
            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showTextDrawer = false">Cancel</BaseButton>
              <BaseButton variant="primary" size="sm" :disabled="!textForm.name.trim() || !textForm.content.trim()" @click="saveTextDocument">
                Save
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <input
      ref="baseImportInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleBaseImportInputChange"
    />

    <input
      ref="documentImportInputRef"
      type="file"
      accept=".txt,.md,.markdown,.html,.htm,.rtf,.doc,.docx,text/plain,text/markdown,text/html"
      multiple
      class="hidden"
      @change="handleDocumentImportInputChange"
    />

    <ConfirmDialog
      v-model="showDeleteConfirm"
      :title="deleteDialogTitle"
      :message="deleteDialogMessage"
      confirm-text="Delete"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
