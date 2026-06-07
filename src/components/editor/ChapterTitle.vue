<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  title: string
}>()

const emit = defineEmits<{
  click: []
  dblclick: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const overflow = ref(false)

const checkOverflow = () => {
  const el = rootRef.value
  if (!el) return
  overflow.value = el.scrollWidth > el.clientWidth
}

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  checkOverflow()
  resizeObserver = new ResizeObserver(() => checkOverflow())
  if (rootRef.value) resizeObserver.observe(rootRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

watch(() => props.title, async () => {
  await nextTick()
  checkOverflow()
})
</script>

<template>
  <div
    ref="rootRef"
    class="chapter-title text-sm"
    :title="overflow ? title : undefined"
    @click="emit('click')"
    @dblclick="emit('dblclick')">
    {{ title }}
  </div>
</template>

<style scoped>
.chapter-title {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
</style>
