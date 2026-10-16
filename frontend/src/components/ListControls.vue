<script setup lang="ts">
/**
 * This component provides controls for sorting and filtering a list of items.
 */

import { ArrowUpDown, ListFilter } from "@lucide/vue";

defineProps<{
  mode: "items" | "entries";
  sort: string;
  query: string;
  type: string;
}>();

const emit = defineEmits<{
  "update:sort": [value: string];
  "update:query": [value: string];
  "update:type": [value: string];
}>();

const selectClass =
  "h-[34px] border border-neutral-400 bg-white px-2 text-[13px] text-neutral-950 outline-none focus:border-neutral-950 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-300";
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 px-1 py-3 dark:border-neutral-700"
    :aria-label="
      mode === 'items' ? 'Sort and filter titles' : 'Sort and filter names'
    "
  >
    <div class="flex flex-wrap items-center gap-2">
      <ArrowUpDown
        :size="16"
        class="mr-1 text-neutral-600 dark:text-neutral-400"
        aria-hidden="true"
      />
      <label class="sr-only" for="list-sort">
        {{ mode === "items" ? "Sort titles" : "Sort names" }}
      </label>
      <select
        id="list-sort"
        :value="sort"
        :class="selectClass"
        @change="
          emit('update:sort', ($event.target as HTMLSelectElement).value)
        "
      >
        <template v-if="mode === 'items'">
          <option value="title-asc">Title: A to Z</option>
          <option value="title-desc">Title: Z to A</option>
          <option value="year-desc">Year: newest first</option>
          <option value="year-asc">Year: oldest first</option>
        </template>
        <template v-else>
          <option value="name-asc">Name: A to Z</option>
          <option value="name-desc">Name: Z to A</option>
        </template>
      </select>

      <template v-if="mode === 'items'">
        <ListFilter
          :size="16"
          class="ml-2 mr-1 text-neutral-600 dark:text-neutral-400"
          aria-hidden="true"
        />
        <label class="sr-only" for="title-type">Filter by type</label>
        <select
          id="title-type"
          :value="type"
          :class="selectClass"
          @change="
            emit('update:type', ($event.target as HTMLSelectElement).value)
          "
        >
          <option value="">All types</option>
          <option value="movie">Movies</option>
          <option value="show">Series</option>
        </select>
      </template>
    </div>

    <label class="sr-only" for="list-search">Search this page</label>
    <input
      id="list-search"
      :value="query"
      class="h-[34px] w-[min(250px,100%)] border border-neutral-400 bg-white px-2 text-[13px] text-neutral-950 outline-none focus:border-neutral-950 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-300"
      type="search"
      maxlength="200"
      :placeholder="mode === 'items' ? 'Search titles' : 'Search names'"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
