<script setup lang="ts">
import { NEllipsis } from 'naive-ui'

defineProps<{
  title: string
}>()

const emit = defineEmits<{
  click: []
  dblclick: []
}>()
</script>

<template>
  <div
    class="chapter-title-host"
    @click="emit('click')"
    @dblclick="emit('dblclick')">
    <NEllipsis
      class="chapter-title text-sm"
      :tooltip="{ maxWidth: 360, placement: 'right' }">
      {{ title }}
    </NEllipsis>
  </div>
</template>

<style scoped>
.chapter-title-host {
  min-width: 0;
  width: 100%;
  cursor: pointer;
}

.chapter-title-host :deep(.n-ellipsis) {
  display: block;
  max-width: 100%;
}
</style>
