<script setup lang="ts" generic="T extends string | number">
withDefaults(defineProps<{ type?: string }>(), { type: 'text' })
const model = defineModel<T>()
</script>

<template>
  <input v-model="model" class="astra-control" :type="type" />
</template>
