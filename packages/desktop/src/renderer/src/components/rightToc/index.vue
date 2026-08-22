<template>
  <aside
    class="side-bar right-toc"
    :style="{ width: `${viewWidth}px` }"
  >
    <div
      ref="dragBar"
      class="drag-bar"
    />
    <div class="right-column">
      <toc />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRightTocStore } from '@/store/rightToc'
import Toc from '@/components/sideBar/toc.vue'

const MIN_WIDTH = 180
const MAX_WIDTH = 500

const rightTocStore = useRightTocStore()
const dragBar = ref<HTMLDivElement | null>(null)
const viewWidth = ref(rightTocStore.rightTocWidth)

let startX = 0
let startWidth = viewWidth.value
let dragging = false

const clampWidth = (width: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))

const mouseMoveHandler = (event: MouseEvent): void => {
  if (!dragging) return
  viewWidth.value = clampWidth(startWidth + startX - event.clientX)
}

const mouseUpHandler = (): void => {
  if (!dragging) return
  dragging = false
  document.removeEventListener('mousemove', mouseMoveHandler, false)
  document.removeEventListener('mouseup', mouseUpHandler, false)
  rightTocStore.SET_RIGHT_TOC_WIDTH(viewWidth.value)
}

const mouseDownHandler = (event: MouseEvent): void => {
  dragging = true
  startX = event.clientX
  startWidth = viewWidth.value
  document.addEventListener('mousemove', mouseMoveHandler, false)
  document.addEventListener('mouseup', mouseUpHandler, false)
}

onMounted(() => {
  dragBar.value?.addEventListener('mousedown', mouseDownHandler, false)
})

onBeforeUnmount(() => {
  dragBar.value?.removeEventListener('mousedown', mouseDownHandler, false)
  document.removeEventListener('mousemove', mouseMoveHandler, false)
  document.removeEventListener('mouseup', mouseUpHandler, false)
})
</script>

<style scoped>
.right-toc {
  display: flex;
  flex-shrink: 0;
  flex-grow: 0;
  min-width: 180px;
  max-width: 500px;
  height: 100vh;
  position: relative;
  box-sizing: border-box;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
  border-left: 1px solid var(--itemBgColor);
  border-right: 0;
}

.right-column {
  flex: 1;
  width: 100%;
  overflow: hidden;
}

.drag-bar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 1;
  height: 100%;
  width: 3px;
  cursor: col-resize;
}

.drag-bar:hover {
  border-left: 2px solid var(--iconColor);
}
</style>
