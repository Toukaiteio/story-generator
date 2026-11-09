<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, FileDown, FileText, RefreshCw, Search, Trash2, Upload, Plus } from 'lucide-vue-next'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  useKnowledgeLibrary,
  useModelCatalog,
  useProviderRuntime,
  buildKnowledgeBaseFileName,
  parseKnowledgeBaseFile,
  serializeKnowledgeBaseFile,
  convertKnowledgeDocumentToMarkdown,
  decodeProviderModelRef,
  encodeProviderModelRef,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

type DeleteTarget = { type: 'base'; id: string } | { type: 'document'; id: string }

const tr = translatePhrase
const knowledge = useKnowledgeLibrary()
const catalog = useModelCatalog()
const runtime = useProviderRuntime()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const search = ref('')
const selectedDocumentId = ref<string | null>(null)
const creating = ref(false)
const newName = ref('')
const deleteTarget = ref<DeleteTarget | null>(null)
const baseFileInput = ref<HTMLInputElement | null>(null)
const documentFileInput = ref<HTMLInputElement | null>(null)
const reindexing = ref(false)

const overflowItems = [
  { label: 'Import base', icon: Upload, action: () => openBaseImport() },
  { label: 'Import documents', icon: FileText, action: () => openDocuments() },
]

const baseMenuItems = computed(() => [
  { label: 'Reindex', icon: RefreshCw, disabled: reindexing.value, action: () => void reindex() },
  { label: 'Export base', icon: FileDown, action: () => exportBase() },
  { divider: true },
  { label: 'Delete base', icon: Trash2, danger: true, action: () => { if (activeBase.value) deleteTarget.value = { type: 'base', id: activeBase.value.id } } },
])

const activeBase = computed(() => knowledge.activeKnowledgeBase)
const documents = computed(() => activeBase.value?.documents ?? [])

const filteredDocuments = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return documents.value
  return documents.value.filter(doc =>
    [doc.name, doc.sourceName ?? '', doc.content].some(value => value.toLowerCase().includes(term)),
  )
})

const selectedDocument = computed(() =>
  documents.value.find(doc => doc.id === selectedDocumentId.value) ?? null,
)

const matches = computed(() => knowledge.searchResults)

const embeddingOptions = computed(() =>
  catalog.modelOptions
    .filter(option => option.supportsEmbeddings)
    .map(option => ({ label: option.label, value: option.value })),
)

const modeOptions = [
  { label: tr('Keyword'), value: 'keyword' },
  { label: tr('Vector'), value: 'vector' },
  { label: tr('Hybrid'), value: 'hybrid' },
]

watch(activeBase, base => {
  if (!base) {
    selectedDocumentId.value = null
    return
  }
  if (!base.documents.some(doc => doc.id === selectedDocumentId.value)) {
    selectedDocumentId.value = base.documents[0]?.id ?? null
  }
}, { immediate: true })

watch(search, () => {
  if (!activeBase.value || !search.value.trim()) {
    knowledge.search('', '')
    return
  }
  void knowledge.searchAsync(activeBase.value.id, search.value.trim())
})

function selectBase(id: string) {
  knowledge.setActiveKnowledgeBase(id)
  selectedDocumentId.value = null
}

function createBase() {
  const name = newName.value.trim()
  if (!name) return
  const base = knowledge.createKnowledgeBase(name, '')
  knowledge.setActiveKnowledgeBase(base.id)
  newName.value = ''
  creating.value = false
  toast.success('Knowledge base created')
}

function setMode(mode: string) {
  if (!activeBase.value) return
  knowledge.setKnowledgeBaseMode(activeBase.value.id, mode as 'keyword' | 'vector' | 'hybrid')
  if (mode !== 'keyword') {
    const fallback = catalog.getEmbeddingModelBinding()
    if (fallback) {
      const match = catalog.getModelByRef(fallback)
      knowledge.setKnowledgeBaseEmbedding(activeBase.value.id, fallback, match?.model.embeddingDimensions ?? null)
    }
  }
}

const embeddingValue = computed(() => {
  const ref = activeBase.value?.embedding.providerModelRef
  return ref ? encodeProviderModelRef(ref) : ''
})

function setEmbedding(value: string) {
  if (!activeBase.value) return
  const ref = value ? decodeProviderModelRef(value) : null
  const match = ref ? catalog.getModelByRef(ref) : null
  knowledge.setKnowledgeBaseEmbedding(activeBase.value.id, ref, match?.model.embeddingDimensions ?? null)
}

async function reindex() {
  if (!activeBase.value || reindexing.value) return
  if (activeBase.value.mode === 'keyword') {
    toast.warning('Keyword mode does not need indexing')
    return
  }
  if (!activeBase.value.embedding.providerModelRef) {
    toast.warning('Pick an embedding model first')
    return
  }
  reindexing.value = true
  try {
    await knowledge.reindexKnowledgeBase(activeBase.value.id)
    toast.success('Knowledge base reindexed')
  } catch (error: any) {
    toast.error(error?.message || 'Reindex failed')
  } finally {
    reindexing.value = false
  }
}

async function importBase(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const base = knowledge.importKnowledgeBase(parseKnowledgeBaseFile(await file.text()))
    knowledge.setActiveKnowledgeBase(base.id)
    toast.success('Knowledge base imported')
  } catch (error: any) {
    toast.error(error?.message || 'Import failed')
  } finally {
    target.value = ''
  }
}

function exportBase() {
  if (!activeBase.value) return
  const blob = new Blob([serializeKnowledgeBaseFile(activeBase.value)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = buildKnowledgeBaseFileName(activeBase.value)
  anchor.click()
  URL.revokeObjectURL(url)
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function importDocuments(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (!files.length || !activeBase.value) return
  for (const file of files) {
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      const result = await convertKnowledgeDocumentToMarkdown({
        fileName: file.name,
        extension,
        bytes: await file.arrayBuffer(),
      })
      if (!result.markdown.trim()) continue
      const doc = knowledge.addDocument(
        activeBase.value.id,
        file.name.replace(/\.[^.]+$/, ''),
        result.markdown,
        'upload',
        { fileType: extension, sourceName: file.name },
      )
      if (doc) selectedDocumentId.value = doc.id
      if (result.warnings.length) toast.warning(result.warnings.join('; '))
    } catch (error: any) {
      toast.error(error?.message || `Failed to import ${file.name}`)
    }
  }
  target.value = ''
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  if (target.type === 'base') {
    await knowledge.removeKnowledgeBase(target.id)
  } else if (activeBase.value) {
    knowledge.removeDocument(activeBase.value.id, target.id)
    if (selectedDocumentId.value === target.id) selectedDocumentId.value = null
  }
  deleteTarget.value = null
}

function importFromElectron(path: string) {
  if (!activeBase.value) return
  void window.electronAPI?.file?.readBinary?.(path).then(async base64 => {
    if (!base64) return
    const fileName = path.split(/[\\/]/).pop() || path
    const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
    const result = await convertKnowledgeDocumentToMarkdown({ fileName, extension, bytes: decodeBase64(base64) })
    if (!result.markdown.trim()) return
    const doc = knowledge.addDocument(activeBase.value!.id, fileName.replace(/\.[^.]+$/, ''), result.markdown, 'upload', {
      fileType: extension,
      sourceName: fileName,
    })
    if (doc) selectedDocumentId.value = doc.id
  })
}

async function openDocuments() {
  const api = window.electronAPI
  if (api?.dialog && api?.file) {
    const paths = await api.dialog.openFiles({
      filters: [{ name: 'Documents', extensions: ['txt', 'md', 'markdown', 'html', 'htm', 'rtf', 'doc', 'docx'] }],
    })
    for (const path of paths ?? []) importFromElectron(path)
    return
  }
  documentFileInput.value?.click()
}

async function openBaseImport() {
  const api = window.electronAPI
  if (api?.dialog && api?.file) {
    const path = await api.dialog.openFile({ filters: [{ name: 'Knowledge base', extensions: ['json'] }] })
    if (!path) return
    const content = await api.file.read(path)
    if (!content) return
    const base = knowledge.importKnowledgeBase(parseKnowledgeBaseFile(content))
    knowledge.setActiveKnowledgeBase(base.id)
    return
  }
  baseFileInput.value?.click()
}

watch(open, value => {
  if (value) runtime.setProviders(catalog.providers)
})
</script>

<template>
  <BaseDrawer v-model="open" :title="tr('Knowledge')" width="480px" flush>
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2">
        <BaseInput v-model="search" class="min-w-[140px] flex-1" :icon="Search" :placeholder="tr('Search knowledge')" />
        <BaseDropdown :items="overflowItems" :width="200">
          <template #trigger>
            <div class="capsule h-9 w-9 px-0" :aria-label="tr('More actions')">
              <span class="text-body leading-none">⋯</span>
            </div>
          </template>
        </BaseDropdown>
        <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="creating = !creating">
          <Plus :size="15" />
          <span>{{ tr('New base') }}</span>
        </button>
        <input ref="baseFileInput" type="file" accept=".json" class="hidden" @change="importBase">
        <input
          ref="documentFileInput"
          type="file"
          multiple
          accept=".txt,.md,.markdown,.html,.htm,.rtf,.doc,.docx"
          class="hidden"
          @change="importDocuments"
        >
      </div>

      <div v-if="creating" class="flex shrink-0 items-center gap-2 px-5 pb-2">
        <BaseInput v-model="newName" class="flex-1" :placeholder="tr('Base name')" @keydown.enter="createBase" />
        <BaseButton variant="primary" size="sm" :disabled="!newName.trim()" @click="createBase">
          {{ tr('Create') }}
        </BaseButton>
      </div>

      <div class="flex shrink-0 flex-wrap gap-1.5 px-5 pb-2">
        <button
          v-for="base in knowledge.sortedKnowledgeBases"
          :key="base.id"
          class="capsule h-8 gap-1 px-3 text-meta"
          :class="activeBase?.id === base.id ? 'capsule--active' : 'bg-surface-2'"
          @click="selectBase(base.id)"
        >
          <span class="max-w-[140px] truncate">{{ base.name }}</span>
          <span class="text-text-muted">{{ base.documents.length }}</span>
        </button>
        <span v-if="!knowledge.sortedKnowledgeBases.length" class="px-2 py-1 text-meta text-text-muted">
          {{ tr('No knowledge bases yet') }}
        </span>
      </div>

      <template v-if="activeBase">
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-2">
          <BaseSegmented :model-value="activeBase.mode" :options="modeOptions" @update:model-value="setMode" />
          <BaseSelect
            v-if="activeBase.mode !== 'keyword'"
            :model-value="embeddingValue"
            :options="embeddingOptions"
            :placeholder="tr('Embedding model')"
            class="min-w-[150px] flex-1"
            @update:model-value="setEmbedding"
          />
          <BaseDropdown :items="baseMenuItems" :width="200">
            <template #trigger>
              <div class="capsule h-9 w-9 px-0" :aria-label="tr('More actions')">
                <span class="text-body leading-none">⋯</span>
              </div>
            </template>
          </BaseDropdown>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <div v-if="search.trim() && matches.length" class="mb-2 space-y-1">
            <button
              v-for="match in matches"
              :key="match.chunk.id"
              class="w-full rounded-ios bg-accent-subtle/60 px-3 py-2 text-left"
              @click="selectedDocumentId = match.chunk.documentId"
            >
              <p class="line-clamp-2 text-meta leading-relaxed text-text-secondary">{{ match.highlight }}</p>
            </button>
          </div>

          <div class="space-y-1.5">
            <div
              v-for="doc in filteredDocuments"
              :key="doc.id"
              class="flex items-center gap-2 rounded-ios bg-surface-1 px-3 py-2.5 shadow-ios-pill"
              :class="selectedDocumentId === doc.id ? 'ring-1 ring-inset ring-accent/40' : ''"
            >
              <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="selectedDocumentId = doc.id">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
                  <BookOpen :size="15" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-caption font-medium text-text-primary">{{ doc.name }}</span>
                  <span class="block text-meta text-text-muted">{{ doc.chunks.length }} {{ tr('chunks') }}</span>
                </span>
              </button>
              <button class="app-icon-button app-icon-button--danger" :aria-label="tr('Delete document')" @click="deleteTarget = { type: 'document', id: doc.id }">
                <Trash2 :size="15" />
              </button>
            </div>

            <p v-if="!filteredDocuments.length" class="px-5 py-6 text-center text-caption text-text-muted">
              {{ documents.length ? tr('No matching documents') : tr('No documents in this base') }}
            </p>
          </div>

          <div v-if="selectedDocument" class="mt-3 rounded-ios bg-surface-2/60 p-3">
            <p class="mb-1 truncate text-meta font-medium text-text-muted">{{ selectedDocument.name }}</p>
            <p class="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-meta leading-relaxed text-text-secondary">
              {{ selectedDocument.content.slice(0, 1200) }}
            </p>
          </div>
        </div>
      </template>

      <p v-else class="px-5 py-6 text-center text-caption text-text-muted">
        {{ tr('Create a base to start collecting reference material.') }}
      </p>
    </div>

    <ConfirmDialog
      :model-value="!!deleteTarget"
      :title="tr('Delete')"
      :message="tr('This permanently removes the selection.')"
      :confirm-text="tr('Delete')"
      variant="danger"
      @update:model-value="value => { if (!value) deleteTarget = null }"
      @confirm="confirmDelete"
    />
  </BaseDrawer>
</template>
