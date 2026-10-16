<script setup lang="ts">
/**
 * This component displays an indicator showing whether the user is old enough for a given content rating.
 */

import { computed } from "vue";
import { CircleCheck, CircleX } from "@lucide/vue";

const props = defineProps<{
  rating: string;
  age: number;
}>();

// New Zealand ratings: https://www.classificationoffice.govt.nz/classification-info/classification-labels/
const minimumAges: Record<string, number> = {
  G: 0,
  PG: 0,
  M: 16,
  RP13: 13,
  R13: 13,
  RP15: 15,
  R15: 15,
  RP16: 16,
  R16: 16,
  RP18: 18,
  R18: 18,
  "PG-13": 13,
  R: 17,
  "NC-17": 18,
  "TV-Y": 0,
  "TV-Y7": 7,
  "TV-G": 0,
  "TV-PG": 0,
  "TV-14": 14,
  "TV-MA": 17,
};

const ratingCode = computed(() => props.rating.trim().toUpperCase());
const minimumAge = computed(() => minimumAges[ratingCode.value]);
const hasKnownRating = computed(() => minimumAge.value !== undefined);
const isOldEnough = computed(
  () => hasKnownRating.value && props.age >= (minimumAge.value ?? 0),
);
const description = computed(() => {
  return isOldEnough.value
    ? `You are old enough for ${props.rating}.`
    : `You are too young for ${props.rating}.`;
});
</script>

<template>
  <span class="group relative inline-flex align-middle">
    <span
      class="inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
      tabindex="0"
      role="img"
      :aria-label="description"
      :title="description"
    >
      <CircleCheck
        v-if="isOldEnough"
        :size="16"
        class="text-green-700 dark:text-green-400"
        aria-hidden="true"
      />
      <CircleX
        v-else-if="hasKnownRating"
        :size="16"
        class="text-red-700 dark:text-red-400"
        aria-hidden="true"
      />
    </span>
    <span
      class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max max-w-56 -translate-x-1/2 border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 shadow-sm group-hover:block group-focus-within:block dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
      aria-hidden="true"
    >
      {{ description }}
    </span>
  </span>
</template>
