<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronRight, Home, Moon, Sun } from "@lucide/vue";
import LoadMoreButton from "@/components/LoadMoreButton.vue";
import ListResults from "@/components/ListResults.vue";

type SectionKey =
  | "titles"
  | "genres"
  | "people"
  | "content-ratings"
  | "countries"
  | "collections"
  | "libraries";

interface Section {
  key: SectionKey;
  label: string;
  singular: string;
  description: string;
}

interface Entry {
  id: number | string;
  name?: string;
  title?: string;
  type?: string;
  item_count?: number;
  profile_picture?: string | null;
  roles?: string[];
}

interface Item {
  id: number;
  title: string;
  type: string;
  year: number | null;
  summary?: string | null;
  content_rating?: string | null;
  studio?: string | null;
  season_count?: number | null;
  episode_count?: number | null;
  poster?: string | null;
  character?: string | null;
  library_id?: number;
  collections?: Entry[];
  genres?: Entry[];
  countries?: Entry[];
  people?: (Entry & { role?: string })[];
}

interface Paginated<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number };
}

const sections: Section[] = [
  {
    key: "titles",
    label: "Titles",
    singular: "Title",
    description: "All movies and series.",
  },
  {
    key: "genres",
    label: "Genres",
    singular: "Genre",
    description: "Browse by genre.",
  },
  {
    key: "people",
    label: "People",
    singular: "Person",
    description: "Actors and other credited people.",
  },
  {
    key: "content-ratings",
    label: "Content ratings",
    singular: "Content rating",
    description: "Browse by content rating.",
  },
  {
    key: "countries",
    label: "Countries",
    singular: "Country",
    description: "Browse by country.",
  },
  {
    key: "collections",
    label: "Collections",
    singular: "Collection",
    description: "Browse collections.",
  },
  {
    key: "libraries",
    label: "Libraries",
    singular: "Library",
    description: "Browse media libraries.",
  },
];

const apiPrefix = "/api/v1";
const path = ref(window.location.pathname);
const query = ref("");
const entries = ref<Entry[]>([]);
const personProfile = ref<Entry | null>(null);
const items = ref<Item[]>([]);
const selectedItem = ref<Item | null>(null);
const pagination = ref<Paginated<unknown>["pagination"] | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const searching = ref(false);
const error = ref("");
const isDark = ref(window.localStorage.getItem("theme") === "dark");
let requestVersion = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let suppressQueryWatch = false;

const parts = computed(() => path.value.split("/").filter(Boolean));
const section = computed(() =>
  sections.find((candidate) => candidate.key === parts.value[0]),
);
const selectedEntry = computed(() =>
  personProfile.value && String(personProfile.value.id) === parts.value[1]
    ? personProfile.value
    : entries.value.find((entry) => String(entry.id) === parts.value[1]),
);
const selectedTitle = computed(
  () => parts.value[0] === "titles" && parts.value.length > 1,
);
const isHome = computed(() => parts.value.length === 0);
const isDetail = computed(() => parts.value.length > 1);
const pageHeading = computed(() => {
  if (isHome.value) return "Media library";
  if (selectedTitle.value && selectedItem.value)
    return selectedItem.value.title;
  if (selectedEntry.value) return entryName(selectedEntry.value);
  return section.value?.label ?? "Not found";
});

// Fetch an API endpoint and provide server errors to the caller.
async function api<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${apiPrefix}${endpoint}`);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

// Fetch a page from the full matching result set using server-side search.
function getPage<T = Item>(endpoint: string, offset = 0, term = "") {
  const params = new URLSearchParams({
    limit: "100",
    offset: String(offset),
  });
  if (term) params.set("q", term);
  return api<Paginated<T>>(`${endpoint}?${params.toString()}`);
}

// Map a section key to the API route that lists its categories.
function entryEndpoint(key: SectionKey) {
  return key === "content-ratings" ? "/content-ratings" : `/${key}`;
}

// Load the data needed for the current home, section, category, or title route.
async function loadPage() {
  const version = ++requestVersion;
  if (searchTimer) clearTimeout(searchTimer);
  searching.value = false;
  suppressQueryWatch = true;
  query.value = "";
  suppressQueryWatch = false;
  entries.value = [];
  personProfile.value = null;
  items.value = [];
  selectedItem.value = null;
  pagination.value = null;
  error.value = "";

  const routeParts = path.value.split("/").filter(Boolean);
  const currentSection = sections.find(
    (candidate) => candidate.key === routeParts[0],
  );
  if (!currentSection) {
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    if (routeParts.length === 1) {
      if (currentSection.key === "titles") {
        const result = await getPage("/items");
        if (version !== requestVersion) return;
        items.value = result.data;
        pagination.value = result.pagination;
      } else {
        const result = await getPage<Entry>(
          entryEndpoint(currentSection.key),
        );
        if (version !== requestVersion) return;
        entries.value = result.data;
        pagination.value = result.pagination;
      }
    } else if (currentSection.key === "titles") {
      const result = await api<Item>(
        `/items/${encodeURIComponent(routeParts[1] ?? "")}`,
      );
      if (version !== requestVersion) return;
      selectedItem.value = result;
    } else if (currentSection.key === "people") {
      const personId = encodeURIComponent(routeParts[1] ?? "");
      const profile = await api<Entry>(`/people/${personId}`);
      if (version !== requestVersion) return;
      personProfile.value = profile;

      const result = await getPage(`/people/${personId}/items`);
      if (version !== requestVersion) return;
      items.value = result.data;
      pagination.value = result.pagination;
    } else {
      const categoryList = await api<Entry[]>(
        entryEndpoint(currentSection.key),
      );
      if (version !== requestVersion) return;
      entries.value = categoryList;
      const category = categoryList.find(
        (entry) => String(entry.id) === routeParts[1],
      );
      if (!category) {
        error.value = `${currentSection.singular} not found.`;
        return;
      }
      const categoryId = encodeURIComponent(String(category.id));
      const result = await getPage(
        `/${currentSection.key}/${categoryId}/items`,
      );
      if (version !== requestVersion) return;
      items.value = result.data;
      pagination.value = result.pagination;
    }
  } catch (cause) {
    if (version === requestVersion) {
      error.value =
        cause instanceof Error
          ? cause.message
          : "Could not load data from the API.";
    }
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

// Replace the current page when search changes, leaving pagination to the API.
async function searchCurrentPage(term: string, version: number) {
  const routeParts = path.value.split("/").filter(Boolean);
  const currentSection = sections.find(
    (candidate) => candidate.key === routeParts[0],
  );
  if (!currentSection || routeParts.length === 0) {
    searching.value = false;
    return;
  }
  error.value = "";

  try {
    if (routeParts.length === 1 && currentSection.key !== "titles") {
      const result = await getPage<Entry>(
        entryEndpoint(currentSection.key),
        0,
        term,
      );
      if (version !== requestVersion) return;
      entries.value = result.data;
      pagination.value = result.pagination;
    } else {
      const endpoint =
        routeParts.length === 1
          ? "/items"
          : `/${currentSection.key}/${encodeURIComponent(routeParts[1] ?? "")}/items`;
      const result = await getPage(endpoint, 0, term);
      if (version !== requestVersion) return;
      items.value = result.data;
      pagination.value = result.pagination;
    }
  } catch (cause) {
    if (version === requestVersion) {
      error.value =
        cause instanceof Error
          ? cause.message
          : "Could not search the database.";
    }
  } finally {
    if (version === requestVersion) searching.value = false;
  }
}

// Append the next page of the current search results.
async function loadMore() {
  if (
    !section.value ||
    !pagination.value ||
    loadingMore.value ||
    searching.value
  )
    return;
  const version = requestVersion;
  loadingMore.value = true;
  error.value = "";
  try {
    const routeParts = path.value.split("/").filter(Boolean);
    let endpoint = "/items";
    if (routeParts.length > 1 && section.value.key !== "titles") {
      endpoint = `/${section.value.key}/${encodeURIComponent(routeParts[1] ?? "")}/items`;
    }
    const isEntryList = routeParts.length === 1 && section.value.key !== "titles";
    if (isEntryList) {
      const result = await getPage<Entry>(
        entryEndpoint(section.value.key),
        entries.value.length,
        query.value.trim(),
      );
      if (version !== requestVersion) return;
      entries.value = [...entries.value, ...result.data];
      pagination.value = result.pagination;
    } else {
      const result = await getPage<Item>(
        endpoint,
        items.value.length,
        query.value.trim(),
      );
      if (version !== requestVersion) return;
      items.value = [...items.value, ...result.data];
      pagination.value = result.pagination;
    }
  } catch (cause) {
    if (version === requestVersion) {
      error.value =
        cause instanceof Error ? cause.message : "Could not load more results.";
    }
  } finally {
    loadingMore.value = false;
  }
}

watch(
  query,
  (term) => {
    if (suppressQueryWatch) return;
    if (searchTimer) clearTimeout(searchTimer);
    const version = ++requestVersion;
    searching.value = true;
    searchTimer = setTimeout(() => {
      void searchCurrentPage(term.trim(), version);
    }, 250);
  },
  { flush: "sync" },
);

// Navigate client-side while preserving normal modified-link browser behavior.
function navigate(event: MouseEvent, destination: string) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  if (path.value !== destination) {
    window.history.pushState({}, "", destination);
    path.value = destination;
    void loadPage();
    window.scrollTo(0, 0);
  }
}

// Reload the displayed route after browser back or forward navigation.
function syncPath() {
  path.value = window.location.pathname;
  void loadPage();
}

// Build a URL for a section, or for one entry within that section.
function routeFor(sectionKey: SectionKey, id?: number | string) {
  return id === undefined
    ? `/${sectionKey}`
    : `/${sectionKey}/${encodeURIComponent(String(id))}`;
}

// Build the detail URL for a linked metadata entry.
function resourceRoute(resource: SectionKey, entry: Entry) {
  return routeFor(resource, entry.id);
}

// Use the display field supplied by the category or library API response.
function entryName(entry: Entry) {
  return entry.name ?? entry.title ?? "";
}

// Present backend item type values in user-facing form.
function formatType(type: string) {
  return type === "show" ? "Series" : type === "movie" ? "Movie" : type;
}

// Present imported credit categories in the profile's readable role list.
function formatPersonRole(role: string) {
  return role.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Toggle the color scheme and remember the selection for the next visit.
function toggleTheme() {
  isDark.value = !isDark.value;
  window.localStorage.setItem("theme", isDark.value ? "dark" : "light");
}

onMounted(() => {
  window.addEventListener("popstate", syncPath);
  void loadPage();
});
onUnmounted(() => {
  window.removeEventListener("popstate", syncPath);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div
    :class="[
      'min-h-screen bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100',
      { dark: isDark },
    ]"
  >
    <header
      class="grid min-h-[58px] grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-3 border-b border-neutral-300 px-[5vw] dark:border-neutral-700"
    >
      <a
        class="grid h-9 w-9 place-items-center justify-self-start text-neutral-900 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-500 dark:text-neutral-100 dark:hover:bg-neutral-800"
        href="/"
        aria-label="Home"
        title="Home"
        @click="navigate($event, '/')"
      >
        <Home :size="20" :stroke-width="1.75" aria-hidden="true" />
      </a>
      <nav
        class="mx-auto flex min-w-0 max-w-full items-center justify-center gap-[18px] overflow-x-auto whitespace-nowrap max-[760px]:justify-start max-[760px]:gap-4"
        aria-label="Main sections"
      >
        <a
          v-for="entry in sections"
          :key="entry.key"
          :class="[
            'shrink-0 border-b-2 border-transparent py-5 text-xs no-underline max-[760px]:py-3',
            section?.key === entry.key
              ? 'border-neutral-950 dark:border-white'
              : 'hover:border-neutral-950 dark:hover:border-white',
          ]"
          :href="routeFor(entry.key)"
          :aria-current="section?.key === entry.key ? 'page' : undefined"
          @click="navigate($event, routeFor(entry.key))"
          >{{ entry.label }}</a
        >
      </nav>
      <button
        class="grid h-9 w-9 place-items-center justify-self-end text-neutral-900 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-500 dark:text-neutral-100 dark:hover:bg-neutral-800"
        type="button"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleTheme"
      >
        <Sun v-if="isDark" :size="20" :stroke-width="1.75" aria-hidden="true" />
        <Moon v-else :size="20" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </header>

    <main
      class="mx-auto min-h-[calc(100vh-58px)] w-[90%] max-w-[1060px] py-[52px] max-[760px]:py-[34px]"
    >
      <div
        class="mb-7 flex items-end justify-between gap-6 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[14px]"
      >
        <div>
          <p
            v-if="!isHome && section"
            class="mb-[13px] flex gap-2 text-xs text-neutral-600 dark:text-neutral-400"
          >
            <a href="/" @click="navigate($event, '/')">Home</a>
            <span>/</span>
            <a
              :href="routeFor(section.key)"
              @click="navigate($event, routeFor(section.key))"
              >{{ section.label }}</a
            >
            <template v-if="isDetail"
              ><span>/</span><span>{{ pageHeading }}</span></template
            >
          </p>
          <h1
            class="m-0 text-[clamp(26px,4vw,38px)] font-medium tracking-[-1px]"
          >
            {{ isHome ? "Media library" : pageHeading }}
          </h1>
          <p
            v-if="isHome"
            class="mt-[9px] max-w-[660px] text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
          >
            Choose a section to explore.
          </p>
          <p
            v-else-if="!isDetail && section"
            class="mt-[9px] max-w-[660px] text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
          >
            {{ section.description }}
          </p>
          <p
            v-else-if="selectedItem?.summary"
            class="mt-[9px] max-w-[660px] text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
          >
            {{ selectedItem.summary }}
          </p>
        </div>
        <input
          v-if="!isHome && !selectedTitle && !loading && !error"
          v-model="query"
          class="h-[34px] w-[min(250px,38vw)] border border-neutral-400 bg-white px-2 text-[13px] text-neutral-950 outline-none focus:border-neutral-950 max-[760px]:w-full dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-300"
          type="search"
          maxlength="200"
          :placeholder="
            section?.key === 'titles' || isDetail ? 'Search titles' : 'Search'
          "
          aria-label="Search"
        />
      </div>

      <p
        v-if="loading"
        class="px-1 py-[18px] text-xs text-neutral-600 dark:text-neutral-400"
      >
        Loading…
      </p>
      <p
        v-else-if="error"
        class="border-y border-red-700 py-[14px] text-[13px] text-red-800 dark:border-red-400 dark:text-red-300"
        role="alert"
      >
        {{ error }}
      </p>

      <section
        v-else-if="isHome"
        class="border-t border-neutral-300 dark:border-neutral-700"
        aria-label="Library sections"
      >
        <a
          v-for="entry in sections"
          :key="entry.key"
          class="grid min-h-[53px] grid-cols-[minmax(130px,1fr)_minmax(150px,2fr)_24px] items-center gap-4 border-b border-neutral-300 px-1 py-2.5 no-underline hover:bg-neutral-100 max-[480px]:grid-cols-[1fr_24px] dark:border-neutral-700 dark:hover:bg-neutral-900"
          :href="routeFor(entry.key)"
          @click="navigate($event, routeFor(entry.key))"
        >
          <span class="text-sm font-medium">{{ entry.label }}</span>
          <span
            class="text-xs text-neutral-600 max-[480px]:hidden dark:text-neutral-400"
            >{{ entry.description }}</span
          >
          <ChevronRight class="ml-auto" :size="16" aria-hidden="true" />
        </a>
      </section>

      <section
        v-else-if="selectedTitle && selectedItem"
        class="grid grid-cols-[minmax(110px,180px)_1fr] items-start gap-8 max-[480px]:grid-cols-1 max-[480px]:gap-[22px]"
      >
        <img
          v-if="selectedItem.poster"
          class="h-auto w-full max-[480px]:w-[min(45vw,160px)]"
          :src="selectedItem.poster"
          :alt="`${selectedItem.title} poster`"
        />
        <dl class="m-0 grid gap-0">
          <div
            class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
          >
            <dt class="text-neutral-600 dark:text-neutral-400">Type</dt>
            <dd class="m-0">{{ formatType(selectedItem.type) }}</dd>
          </div>
          <div
            v-if="selectedItem.year"
            class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
          >
            <dt class="text-neutral-600 dark:text-neutral-400">Year</dt>
            <dd class="m-0">{{ selectedItem.year }}</dd>
          </div>
          <div
            v-if="selectedItem.content_rating"
            class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
          >
            <dt class="text-neutral-600 dark:text-neutral-400">
              Content rating
            </dt>
            <dd class="m-0">
              <a
                :href="routeFor('content-ratings', selectedItem.content_rating)"
                @click="
                  navigate(
                    $event,
                    routeFor('content-ratings', selectedItem.content_rating),
                  )
                "
                >{{ selectedItem.content_rating }}</a
              >
            </dd>
          </div>
          <div
            v-if="selectedItem.studio"
            class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
          >
            <dt class="text-neutral-600 dark:text-neutral-400">Studio</dt>
            <dd class="m-0">{{ selectedItem.studio }}</dd>
          </div>
          <div
            v-if="selectedItem.season_count"
            class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
          >
            <dt class="text-neutral-600 dark:text-neutral-400">Seasons</dt>
            <dd class="m-0">{{ selectedItem.season_count }}</dd>
          </div>
          <template
            v-for="resource in [
              'genres',
              'people',
              'countries',
              'collections',
            ] as const"
            :key="resource"
          >
            <div
              v-if="selectedItem[resource]?.length"
              class="grid grid-cols-[150px_1fr] gap-[14px] border-b border-neutral-300 py-3 text-[13px] max-[480px]:grid-cols-[115px_1fr] dark:border-neutral-700"
            >
              <dt class="text-neutral-600 dark:text-neutral-400">
                {{
                  resource === "people"
                    ? "People"
                    : resource[0]?.toUpperCase() + resource.slice(1)
                }}
              </dt>
              <dd class="m-0 flex flex-wrap gap-x-[14px] gap-y-[6px]">
                <a
                  v-for="related in selectedItem[resource]"
                  :key="related.id"
                  :href="resourceRoute(resource, related)"
                  @click="navigate($event, resourceRoute(resource, related))"
                  class="hover:decoration-2"
                  >{{ related.name }}</a
                >
              </dd>
            </div>
          </template>
        </dl>
      </section>

      <section
        v-else-if="section?.key === 'people' && selectedEntry"
        class="space-y-10"
        aria-label="Person profile"
      >
        <div class="flex items-start gap-7 max-[560px]:flex-col">
          <img
            v-if="selectedEntry.profile_picture"
            class="h-48 w-40 shrink-0 border border-neutral-300 object-cover dark:border-neutral-700"
            :src="selectedEntry.profile_picture"
            :alt="`${entryName(selectedEntry)} profile`"
          />
          <div class="max-w-2xl">
            <p
              v-if="selectedEntry.roles?.length"
              class="mb-2 text-sm text-neutral-600 dark:text-neutral-400"
            >
              {{ selectedEntry.roles.map(formatPersonRole).join(" · ") }}
            </p>
            <h2 class="text-3xl font-medium">{{ entryName(selectedEntry) }}</h2>
            <p class="mb-5 mt-2 text-xl text-neutral-700 dark:text-neutral-300">
              {{
                (query.trim() ? pagination?.total : selectedEntry.item_count) ??
                  pagination?.total ??
                  items.length
              }}
              {{
                ((query.trim()
                  ? pagination?.total
                  : selectedEntry.item_count) ??
                  pagination?.total ??
                  items.length) === 1
                  ? "title"
                  : "titles"
              }}
            </p>
          </div>
        </div>

        <ListResults
          class="pt-5"
          :items="items"
          :total="pagination?.total ?? items.length"
          :format-type="formatType"
          person-mode
          :loading-more="loadingMore"
          :searching="searching"
          @navigate="navigate"
          @load-more="loadMore"
        />
      </section>

      <ListResults
        v-else-if="isDetail && selectedEntry"
        label="Titles in category"
        :items="items"
        :total="pagination?.total ?? items.length"
        :format-type="formatType"
        :loading-more="loadingMore"
        :searching="searching"
        @navigate="navigate"
        @load-more="loadMore"
      />

      <ListResults
        v-else-if="section?.key === 'titles'"
        :items="items"
        :total="pagination?.total ?? items.length"
        :format-type="formatType"
        :loading-more="loadingMore"
        :searching="searching"
        @navigate="navigate"
        @load-more="loadMore"
      />

      <section
        v-else-if="section"
        class="border-t border-neutral-300 dark:border-neutral-700"
        :aria-label="section.label"
      >
        <a
          v-for="entry in entries"
          :key="entry.id"
          class="grid min-h-[53px] grid-cols-[1fr_1fr_24px] items-center gap-4 border-b border-neutral-300 px-1 py-2.5 no-underline hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          :href="resourceRoute(section.key, entry)"
          @click="navigate($event, resourceRoute(section.key, entry))"
        >
          <span class="text-sm font-medium">{{ entryName(entry) }}</span>
          <span class="text-xs text-neutral-600 dark:text-neutral-400">{{
            entry.type ?? ""
          }}</span>
          <ChevronRight class="ml-auto" :size="16" aria-hidden="true" />
        </a>
        <p
          v-if="!entries.length"
          class="px-1 py-[18px] text-xs text-neutral-600 dark:text-neutral-400"
        >
          No categories found.
        </p>
        <LoadMoreButton
          v-if="pagination && entries.length < pagination.total"
          :loading="loadingMore"
          :disabled="searching"
          @click="loadMore"
        />
      </section>
    </main>
  </div>
</template>
