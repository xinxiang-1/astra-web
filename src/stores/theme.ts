import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'astra-theme'

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // ignore
  }
  return 'light'
}

function applyDom(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored())
  const isDark = computed(() => mode.value === 'dark')

  function setTheme(next: ThemeMode) {
    mode.value = next
  }

  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
  }

  watch(
    mode,
    (value) => {
      applyDom(value)
      try {
        localStorage.setItem(STORAGE_KEY, value)
      } catch {
        // ignore
      }
    },
    { immediate: true },
  )

  return { mode, isDark, setTheme, toggle }
})
