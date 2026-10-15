<script setup lang="ts">
import LoadMoreButton from "@/components/LoadMoreButton.vue";

interface ListResult {
  id: number;
  title: string;
  type: string;
  year: number | null;
  character?: string | null;
}

defineProps<{
  items: ListResult[];
  total: number;
  formatType: (type: string) => string;
  label?: string;
  personMode?: boolean;
  loadingMore: boolean;
  searching: boolean;
}>();

const emit = defineEmits<{
  navigate: [event: MouseEvent, destination: string];
  loadMore: [];
}>();

function titleRoute(id: number) {
  return `/titles/${encodeURIComponent(String(id))}`;
}
</script>

<template>
  <section
    class="border-t border-neutral-300 dark:border-neutral-700"
    :aria-label="label ?? (personMode ? 'Titles in person profile' : 'Titles')"
  >
    <p
      v-if="!personMode"
      class="mb-0 px-1 pb-3 text-xs text-neutral-600 dark:text-neutral-400"
    >
      {{ total }} titles
    </p>
    <a
      v-for="item in items"
      :key="item.id"
      :class="
        personMode
          ? 'grid min-h-[68px] grid-cols-[1fr_70px_90px] items-center gap-4 border-b border-neutral-300 px-1 py-3 no-underline hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
          : 'grid min-h-[53px] grid-cols-[1fr_70px_90px] items-center gap-4 border-b border-neutral-300 px-1 py-2.5 no-underline hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
      "
      :href="titleRoute(item.id)"
      @click="emit('navigate', $event, titleRoute(item.id))"
    >
      <span v-if="personMode" class="flex flex-col gap-1">
        <span class="text-base font-medium">{{ item.title }}</span>
        <span
          v-if="item.character"
          class="text-sm text-neutral-600 dark:text-neutral-400"
        >
          As {{ item.character }}
        </span>
      </span>
      <span v-else class="text-sm font-medium">{{ item.title }}</span>
      <span class="text-right text-xs text-neutral-600 dark:text-neutral-400">
        {{ item.year ?? "" }}
      </span>
      <span class="text-right text-xs text-neutral-600 dark:text-neutral-400">
        {{ formatType(item.type) }}
      </span>
    </a>
    <p
      v-if="!items.length"
      class="px-1 py-[18px] text-xs text-neutral-600 dark:text-neutral-400"
    >
      No titles found.
    </p>
    <LoadMoreButton
      v-if="items.length < total"
      :loading="loadingMore"
      :disabled="searching"
      @click="emit('loadMore')"
    />
  </section>
</template>
