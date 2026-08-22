import { ref } from 'vue'
import { defineStore } from 'pinia'

const MIN_WIDTH = 180
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 260
const WIDTH_STORAGE_KEY = 'right-toc-width'
const VISIBILITY_STORAGE_KEY = 'right-toc-visible'

const normalizeWidth = (width: unknown): number => {
  if (width === null || width === undefined || width === '') return DEFAULT_WIDTH
  const numericWidth = Number(width)
  if (!Number.isFinite(numericWidth)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, numericWidth))
}

const initialWidth = normalizeWidth(localStorage.getItem(WIDTH_STORAGE_KEY))
const initialVisibility = localStorage.getItem(VISIBILITY_STORAGE_KEY) === 'true'

export const useRightTocStore = defineStore('rightToc', () => {
  const showRightToc = ref(initialVisibility)
  const rightTocWidth = ref(initialWidth)

  function SET_RIGHT_TOC_VISIBLE(visible: boolean): void {
    showRightToc.value = visible
    localStorage.setItem(VISIBILITY_STORAGE_KEY, String(visible))
  }

  function TOGGLE_RIGHT_TOC(): void {
    SET_RIGHT_TOC_VISIBLE(!showRightToc.value)
  }

  function SET_RIGHT_TOC_WIDTH(width: number): void {
    const normalizedWidth = normalizeWidth(width)
    rightTocWidth.value = normalizedWidth
    localStorage.setItem(WIDTH_STORAGE_KEY, String(normalizedWidth))
  }

  return {
    showRightToc,
    rightTocWidth,
    SET_RIGHT_TOC_VISIBLE,
    TOGGLE_RIGHT_TOC,
    SET_RIGHT_TOC_WIDTH
  }
})
