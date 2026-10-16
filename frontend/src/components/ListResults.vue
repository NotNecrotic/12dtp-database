<script setup lang="ts">
/**
 * This component displays a list of results with sorting and filtering capabilities.
 */

import ListControls from "@/components/ListControls.vue";
import LoadMoreButton from "@/components/LoadMoreButton.vue";
import AgeRatingIndicator from "@/components/AgeRatingIndicator.vue";

interface ListResult {
  id: number;
  title: string;
  type: string;
  year: number | null;
  content_rating?: string | null;
  character?: string | null;
}

defineProps<{
  items: ListResult[];
  age: number;
  total: number;
  formatType: (type: string) => string;
  query: string;
  sort: string;
  typeFilter: string;
  label?: string;
  personMode?: boolean;
  loadingMore: boolean;
  searching: boolean;
}>();

const emit = defineEmits<{
  navigate: [event: MouseEvent, destination: string];
  loadMore: [];
  "update:sort": [value: string];
  "update:query": [value: string];
  "update:typeFilter": [value: string];
}>();

function titleRoute(id: number) {
  return `/titles/${encodeURIComponent(String(id))}`;
}

function isRated(rating: string | null | undefined): rating is string {
  return Boolean(rating?.trim() && rating.trim().toLowerCase() !== "not rated");
}
</script>

<template>
  <section
    class="border-t border-neutral-300 dark:border-neutral-700"
    :aria-label="label ?? (personMode ? 'Titles in person profile' : 'Titles')"
  >
    <ListControls
      mode="items"
      :sort="sort"
      :query="query"
      :type="typeFilter"
      @update:sort="emit('update:sort', $event)"
      @update:query="emit('update:query', $event)"
      @update:type="emit('update:typeFilter', $event)"
    />
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
        <span class="flex flex-wrap items-center gap-2 text-base font-medium">
          {{ item.title }}
          <span
            v-if="isRated(item.content_rating)"
            class="inline-flex items-center gap-1 text-xs font-normal text-neutral-600 dark:text-neutral-400"
          >
            {{ item.content_rating }}
            <AgeRatingIndicator :rating="item.content_rating" :age="age" />
          </span>
        </span>
        <span
          v-if="item.character"
          class="text-sm text-neutral-600 dark:text-neutral-400"
        >
          As {{ item.character }}
        </span>
      </span>
      <span
        v-else
        class="flex flex-wrap items-center gap-2 text-sm font-medium"
      >
        {{ item.title }}
        <span
          v-if="isRated(item.content_rating)"
          class="inline-flex items-center gap-1 text-xs font-normal text-neutral-600 dark:text-neutral-400"
        >
          {{ item.content_rating }}
          <AgeRatingIndicator :rating="item.content_rating" :age="age" />
        </span>
      </span>
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
