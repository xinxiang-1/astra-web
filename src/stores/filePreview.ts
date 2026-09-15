import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useFilePreviewStore = defineStore('filePreview', () => {
  const file = ref<File | null>(null)

  const hasFile = computed(() => file.value != null)
  const fileName = computed(() => file.value?.name ?? '')
  const fileSizeLabel = computed(() => {
    const size = file.value?.size
    if (size == null) return ''
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  })

  function setFile(next: File | null) {
    file.value = next
  }

  function clear() {
    file.value = null
  }

  return {
    file,
    hasFile,
    fileName,
    fileSizeLabel,
    setFile,
    clear,
  }
})
