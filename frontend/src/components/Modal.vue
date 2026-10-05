<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card">
      <header class="modal-head">
        <strong>{{ title }}</strong>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="modal-foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ (e: 'close'): void }>()
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  width: min(560px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-body {
  padding: 14px 16px;
  overflow: auto;
}
.modal-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.form-row label {
  font-size: 12px;
  color: var(--muted);
}
.form-row input,
.form-row select,
.form-row textarea {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
</style>
