<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  busy: boolean
  error: string
  action: '离开' | '清空'
}>()
const emit = defineEmits<{ cancel: []; discard: []; save: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
function onDialogKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const buttons = [
    ...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ]
  const first = buttons[0]
  const last = buttons.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open && dialog.value && !dialog.value.open) dialog.value.showModal()
    else if (!open) dialog.value?.close()
  },
  { immediate: true, flush: 'post' },
)
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog
    ref="dialog"
    class="unsaved-dialog"
    aria-labelledby="unsaved-title"
    aria-describedby="unsaved-description"
    @cancel.prevent="emit('cancel')"
    @keydown="onDialogKeydown"
  >
    <span class="art-eyebrow">KEEP YOUR CREATION</span>
    <h2 id="unsaved-title">保留这次创作？</h2>
    <p id="unsaved-description">
      当前作品有未保存的素材或调整。保存后可以回来继续创作，放弃更改会丢失本次调整。
    </p>
    <p v-if="busy" class="unsaved-note" role="status">正在处理作品，请稍候；也可以继续编辑。</p>
    <p v-if="error" class="unsaved-error" role="alert">{{ error }}</p>
    <div class="unsaved-actions">
      <button type="button" class="art-button" autofocus @click="emit('cancel')">继续编辑</button>
      <button type="button" class="art-button discard" :disabled="busy" @click="emit('discard')">
        放弃更改并{{ action }}
      </button>
      <button type="button" class="art-button primary" :disabled="busy" @click="emit('save')">
        保存并{{ action }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.unsaved-dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  padding: 32px;
  background: var(--art-paper, #f4f2eb);
  color: var(--art-ink, #182019);
  border: 1px solid #a9b1a5;
  border-radius: 16px;
  box-shadow: 0 20px 80px #0006;
}
.unsaved-dialog::backdrop {
  background: #0a120ed9;
}
.unsaved-dialog h2 {
  margin: 14px 0;
  font-size: 28px;
}
.unsaved-dialog p {
  font-size: 14px;
  line-height: 1.8;
}
.unsaved-note {
  color: #52664d;
}
.unsaved-error {
  color: #9f3121;
}
.unsaved-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}
.unsaved-actions .art-button {
  min-height: 44px;
  padding: 10px 16px;
  font-size: 12px;
}
.unsaved-actions .discard {
  color: #9f3121;
}
@media (max-width: 600px) {
  .unsaved-dialog {
    padding: 24px;
  }
  .unsaved-actions {
    flex-direction: column;
  }
  .unsaved-actions .art-button {
    width: 100%;
  }
}
</style>
