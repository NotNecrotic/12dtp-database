<script setup lang="ts">
import { ref } from "vue";
import { ShieldCheck } from "@lucide/vue";

const emit = defineEmits<{
  submitAge: [age: number];
}>();

defineProps<{
  dark: boolean;
}>();

const ageInput = ref<number | string>("");
const error = ref("");

function submitAge() {
  const age = Number(ageInput.value);
  if (
    String(ageInput.value).trim() === "" ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > 120
  ) {
    error.value = "Enter a whole number between 0 and 120.";
    return;
  }

  emit("submitAge", age);
}
</script>

<template>
  <main
    :class="{ dark }"
    class="grid min-h-screen place-items-center bg-white px-5 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100"
  >
    <form
      class="w-full max-w-[380px] border border-neutral-300 p-6 dark:border-neutral-700"
      @submit.prevent="submitAge"
    >
      <h1 class="mb-2 text-2xl font-medium">Set your age</h1>
      <p
        class="mb-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
      >
        This is used to determine the content that is appropriate for you.
      </p>
      <label for="viewer-age" class="mb-2 block text-sm">Your age</label>
      <input
        id="viewer-age"
        v-model="ageInput"
        class="h-10 w-full border border-neutral-400 bg-white px-3 text-sm outline-none focus:border-neutral-950 dark:border-neutral-600 dark:bg-neutral-900 dark:focus:border-neutral-300"
        type="number"
        min="0"
        max="120"
        step="1"
        required
        autofocus
        :aria-invalid="Boolean(error)"
        :aria-describedby="error ? 'age-error' : undefined"
      />
      <p
        v-if="error"
        id="age-error"
        class="mt-2 text-sm text-red-800 dark:text-red-300"
        role="alert"
      >
        {{ error }}
      </p>
      <button
        class="mt-5 h-10 w-full border border-neutral-950 bg-neutral-950 px-4 text-sm text-white hover:bg-neutral-800 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-300"
        type="submit"
      >
        Continue
      </button>
    </form>
  </main>
</template>
