<script setup lang="ts">
interface Category {
  key: string;
  label: string;
  description: string;
  image: string;
  tint: string;
}

defineProps<{
  categories: Category[];
}>();

const emit = defineEmits<{
  navigate: [event: MouseEvent, destination: string];
}>();

function routeFor(key: string) {
  return `/${key}`;
}
</script>

<template>
  <section aria-label="Browse categories">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <a
        v-for="category in categories"
        :key="category.key"
        class="group relative isolate flex min-h-[clamp(190px,30vh,380px)] items-end overflow-hidden border border-neutral-300 bg-neutral-300 text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700 dark:border-neutral-700 dark:bg-neutral-800"
        :href="routeFor(category.key)"
        @click="emit('navigate', $event, routeFor(category.key))"
      >
        <img
          class="absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          :src="category.image"
          alt=""
          loading="lazy"
        />
        <span
          class="absolute inset-0 -z-10 opacity-80 mix-blend-color"
          :style="{ backgroundColor: category.tint }"
          aria-hidden="true"
        />
        <span
          class="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
          aria-hidden="true"
        />
        <span class="p-6 sm:p-7">
          <span class="block text-2xl font-medium sm:text-3xl">
            {{ category.label }}
          </span>
          <span class="mt-2 block max-w-sm text-sm text-white/85">
            {{ category.description }}
          </span>
        </span>
      </a>
    </div>
  </section>
</template>
