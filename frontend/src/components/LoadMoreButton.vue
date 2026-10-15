<script setup lang="ts">
defineProps<{
  loading: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="mt-[18px] border border-neutral-500 bg-white px-3 py-[9px] text-xs hover:bg-neutral-100 disabled:cursor-wait disabled:text-neutral-500 dark:border-neutral-600 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:disabled:text-neutral-500"
    :disabled="disabled || loading"
    @click="emit('click')"
  >
    {{ loading ? "Loading…" : "Load more" }}
  </button>
</template>
