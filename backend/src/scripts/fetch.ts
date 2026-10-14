/**
 * Fetches movie and TV library metadata from Plex and upserts it into SQLite.
 */

import "@/db/schema.js";
import { config } from "@/config/env.js";
import { db } from "@/db/database.js";
import type {
  PlexLibrary,
  PlexLibraryItem,
  PlexPerson,
} from "@/types/index.js";

interface PlexResponse {
  MediaContainer?: {
    size?: number;
    totalSize?: number;
    Metadata?: PlexMetadata[];
    Directory?: PlexLibrarySection[];
  };
}

interface PlexLibrarySection {
  key: string;
  title: string;
  type: string;
}

interface PlexTag {
  tag: string;
}

interface PlexRole extends PlexTag {
  role?: string;
  thumb?: string;
}

interface PlexMetadata {
  ratingKey: string;
  title: string;
  type: PlexLibraryItem["type"];
  year?: number;
  summary?: string;
  contentRating?: string;
  studio?: string;
  childCount?: number;
  leafCount?: number;
  parentIndex?: number;
  index?: number;
  grandparentRatingKey?: string;
  thumb?: string;
  art?: string;
  Genre?: PlexTag[];
  Collection?: PlexTag[];
  Country?: PlexTag[];
  Role?: PlexRole[];
  Director?: PlexTag[];
  Writer?: PlexTag[];
  Producer?: PlexTag[];
  ExecutiveProducer?: PlexTag[];
}

// Plex uses pagination. This sets the amount of items to return per request.
const PAGE_SIZE = 1000;
// Limit of how many detail requests can be sent at the same time. A detail request is a request for a single library item.
const DETAIL_CONCURRENCY = 8;

// Convert a Plex identifier to a safe integer for the database.
function toId(value: string, name: string): number {
  const id = Number(value);

  // Database IDs need to stay exact integers.
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Plex returned an invalid ${name}: ${value}`);
  }

  return id;
}

// Turn a Plex artwork path into a full URL that includes the access token.
function toAssetUrl(
  baseUrl: string,
  path: string | undefined,
  token: string,
): string | null {
  if (!path) {
    return null;
  }

  // Plex image paths are relative, the token makes each URL directly usable.
  const url = new URL(path, baseUrl);
  url.searchParams.set("X-Plex-Token", token);

  return url.toString();
}

// Return trimmed tag names from Plex metadata.
function tagNames(tags: PlexTag[] | undefined): string[] {
  // Normalize Plex's tag objects into unique names for the lookup tables.
  return [
    ...new Set(
      (tags ?? []).map(({ tag }) => tag.trim()).filter((tag) => tag.length > 0),
    ),
  ];
}

// Extract and deduplicate cast, director, and writer "people" for an item.
function itemPeople(
  metadata: PlexMetadata,
  baseUrl: string,
  token: string,
): PlexPerson[] {
  const people = [
    ...(metadata.Role ?? []).map(({ tag, role: character, thumb }) => ({
      name: tag.trim(),
      role: "actor",
      character: character?.trim() || null,
      profilePicture: toAssetUrl(baseUrl, thumb, token),
    })),
    ...tagNames(metadata.Director).map((name) => ({ name, role: "director" })),
    ...tagNames(metadata.Writer).map((name) => ({ name, role: "writer" })),
    ...tagNames(metadata.Producer).map((name) => ({ name, role: "producer" })),
    ...tagNames(metadata.ExecutiveProducer).map((name) => ({
      name,
      role: "executive producer",
    })),
  ].filter(({ name }) => name.length > 0);
  const uniquePeople = new Map(
    people.map((person) => [`${person.name}\0${person.role}`, person]),
  );

  return [...uniquePeople.values()];
}

// Run the mapper on every value, with no more than `concurrency` calls at a time.
async function mapConcurrent<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await mapper(values[index]!);
      }
    }),
  );

  return results;
}

// Fetch all collections in a library and map their names to items.
async function fetchCollections(
  baseUrl: string,
  libraryId: number,
  token: string,
): Promise<{ names: string[]; items: Map<number, Set<string>> }> {
  const names = new Set<string>();
  const items = new Map<number, Set<string>>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const collectionPage = await plexRequest<PlexResponse>(
      `${baseUrl}/library/sections/${libraryId}/collections` +
        `?X-Plex-Container-Size=${PAGE_SIZE}` +
        `&X-Plex-Container-Start=${offset}`,
      token,
    );
    const container = collectionPage.MediaContainer;
    const collections = container?.Metadata ?? [];

    if (collections.length === 0) {
      break;
    }

    for (const collection of collections) {
      const collectionName = collection.title.trim();

      if (!collectionName) {
        continue;
      }

      names.add(collectionName);

      // Plex exposes collection members separately from the library item list.
      let memberOffset = 0;
      let memberTotal = Number.POSITIVE_INFINITY;

      while (memberOffset < memberTotal) {
        const membersPage = await plexRequest<PlexResponse>(
          `${baseUrl}/library/collections/${encodeURIComponent(collection.ratingKey)}/children` +
            `?X-Plex-Container-Size=${PAGE_SIZE}` +
            `&X-Plex-Container-Start=${memberOffset}`,
          token,
        );
        const memberContainer = membersPage.MediaContainer;
        const members = memberContainer?.Metadata ?? [];

        if (members.length === 0) {
          break;
        }

        for (const member of members) {
          const itemId = toId(member.ratingKey, "collection item rating key");
          const collectionNames = items.get(itemId) ?? new Set<string>();
          collectionNames.add(collectionName);
          items.set(itemId, collectionNames);
        }

        memberOffset += members.length;
        memberTotal =
          memberContainer?.totalSize ?? memberContainer?.size ?? memberOffset;
      }
    }

    offset += collections.length;
    total = container?.totalSize ?? container?.size ?? offset;
  }

  return { names: [...names], items };
}

// Make an authenticated Plex API request and parse its JSON response.
async function plexRequest<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Plex-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`Plex API ${response.status}: ${response.statusText}`);
  }

  // Plex returns JSON when the Accept header is set above.
  return response.json() as Promise<T>;
}

// Fetch supported libraries, their items, collections, and people metadata.
async function fetchData(url: string, token: string): Promise<PlexLibrary[]> {
  // Normalize url so relative artwork paths and API routes share the same base.
  const baseUrl = url.replace(/\/$/, "");

  const sectionResponse = await plexRequest<PlexResponse>(
    `${baseUrl}/library/sections`,
    token,
  );

  const container = sectionResponse.MediaContainer;

  if (!container) {
    throw new Error("Plex API response did not include a MediaContainer");
  }

  const sectionList = container.Directory;

  if (!sectionList) {
    throw new Error("Plex API response did not include library sections");
  }

  // Libraries that are not movies or shows are ignored.
  const libraries = sectionList.filter(
    (library): library is PlexLibrarySection & { type: PlexLibrary["type"] } =>
      library.type === "movie" || library.type === "show",
  );

  if (libraries.length === 0) {
    console.log("No movie or TV libraries found.");
  }

  const result: PlexLibrary[] = [];

  for (const library of libraries) {
    const key = toId(library.key, "library key");
    const title = library.title;

    console.log(`Scraping library: ${title}`);

    const collectionData = await fetchCollections(baseUrl, key, token);
    const items: PlexLibraryItem[] = [];

    let offset = 0;

    // Fetch each library page until Plex reports there are no more items.
    while (true) {
      const url =
        `${baseUrl}/library/sections/${key}/all` +
        `?X-Plex-Container-Size=${PAGE_SIZE}` +
        `&X-Plex-Container-Start=${offset}`;

      const page = await plexRequest<PlexResponse>(url, token);

      const pageItems = page.MediaContainer?.Metadata ?? [];

      if (pageItems.length === 0) {
        break;
      }

      // Fetch detailed metadata for each item concurrently.
      const peopleByItem = await mapConcurrent(
        pageItems,
        DETAIL_CONCURRENCY,
        async (item) => {
          const details = await plexRequest<PlexResponse>(
            `${baseUrl}/library/metadata/${encodeURIComponent(item.ratingKey)}`,
            token,
          );
          const detailedItem = details.MediaContainer?.Metadata?.[0];

          if (!detailedItem) {
            throw new Error(
              `Plex returned no metadata for item ${item.ratingKey}`,
            );
          }

          return itemPeople(detailedItem, baseUrl, token);
        },
      );

      for (const [index, item] of pageItems.entries()) {
        // Keep Plex tags and artwork alongside the core item fields for insertion.
        items.push({
          id: toId(item.ratingKey, "rating key"),
          libraryId: key,
          ratingKey: String(item.ratingKey),
          title: item.title,
          type: item.type,
          ...(item.year !== undefined && { year: item.year }),
          ...(item.summary !== undefined && { summary: item.summary }),
          ...(item.contentRating !== undefined && {
            contentRating: item.contentRating,
          }),
          ...(item.studio !== undefined && { studio: item.studio }),
          ...(item.childCount !== undefined && {
            seasonCount: item.childCount,
          }),
          ...(item.leafCount !== undefined && {
            episodeCount: item.leafCount,
          }),
          ...(item.grandparentRatingKey && {
            show: toId(item.grandparentRatingKey, "show rating key"),
          }),
          ...(item.parentIndex !== undefined && { season: item.parentIndex }),
          ...(item.index !== undefined && { episode: item.index }),
          poster: toAssetUrl(baseUrl, item.thumb, token),
          background: toAssetUrl(baseUrl, item.art, token),
          genres: tagNames(item.Genre),
          collections: [
            ...new Set([
              ...tagNames(item.Collection),
              ...(collectionData.items.get(
                toId(item.ratingKey, "rating key"),
              ) ?? []),
            ]),
          ],
          countries: tagNames(item.Country),
          people: peopleByItem[index] ?? itemPeople(item, baseUrl, token),
        });
      }

      console.log(`  ${items.length} items scraped...`);

      const total =
        page.MediaContainer?.totalSize ??
        page.MediaContainer?.size ??
        pageItems.length;

      offset += pageItems.length;

      if (offset >= total || pageItems.length < PAGE_SIZE) {
        break;
      }
    }

    result.push({
      id: key,
      title,
      type: library.type,
      collections: collectionData.names,
      items,
    });

    const peopleCount = items.reduce(
      (count, item) => count + item.people.length,
      0,
    );
    console.log(
      `  ${collectionData.names.length} collections and ${peopleCount} people found.`,
    );
  }

  return result;
}

// Upsert fetched Plex data into the database in one transaction.
async function generateData(url: string, token: string): Promise<void> {
  const data = await fetchData(url, token);

  const insertLibrary = db.prepare(`
    INSERT INTO libraries (
      id,
      title,
      type
    )
    VALUES (
      @id,
      @title,
      @type
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type
  `);

  const insertItem = db.prepare(`
    INSERT INTO items (
      id,
      library_id,
      rating_key,
      title,
      type,
      year,
      summary,
      content_rating,
      studio,
      season_count,
      episode_count,
      show,
      season,
      episode
    )
    VALUES (
      @id,
      @library_id,
      @rating_key,
      @title,
      @type,
      @year,
      @summary,
      @content_rating,
      @studio,
      @season_count,
      @episode_count,
      @show,
      @season,
      @episode
    )
    ON CONFLICT(id) DO UPDATE SET
      library_id = excluded.library_id,
      rating_key = excluded.rating_key,
      title = excluded.title,
      type = excluded.type,
      year = excluded.year,
      summary = excluded.summary,
      content_rating = excluded.content_rating,
      studio = excluded.studio,
      season_count = excluded.season_count,
      episode_count = excluded.episode_count,
      show = excluded.show,
      season = excluded.season,
      episode = excluded.episode
  `);

  const insertArtwork = db.prepare(`
    INSERT INTO artwork (
      item_id,
      poster,
      background
    )
    VALUES (
      @item_id,
      @poster,
      @background
    )
    ON CONFLICT(item_id) DO UPDATE SET
      poster = excluded.poster,
      background = excluded.background
  `);

  const clearItemCollections = db.prepare(
    "DELETE FROM item_collections WHERE item_id = @item_id",
  );
  const clearItemCountries = db.prepare(
    "DELETE FROM item_countries WHERE item_id = @item_id",
  );
  const clearItemGenres = db.prepare(
    "DELETE FROM item_genres WHERE item_id = @item_id",
  );
  const clearItemPeople = db.prepare(
    "DELETE FROM item_people WHERE item_id = @item_id",
  );

  const insertItemCollection = db.prepare(`
    INSERT INTO item_collections (item_id, collection_id)
    VALUES (@item_id, @collection_id)
  `);
  const insertItemCountry = db.prepare(`
    INSERT INTO item_countries (item_id, country_id)
    VALUES (@item_id, @country_id)
  `);
  const insertItemGenre = db.prepare(`
    INSERT INTO item_genres (item_id, genre_id)
    VALUES (@item_id, @genre_id)
  `);
  const insertItemPerson = db.prepare(`
    INSERT INTO item_people (item_id, person_id, role, character)
    VALUES (@item_id, @person_id, @role, @character)
  `);
  const updatePersonProfile = db.prepare(`
    UPDATE people
    SET profile_picture = COALESCE(@profile_picture, profile_picture)
    WHERE id = @person_id
  `);
  const lookupIds: Record<LookupTable, Map<string, number>> = {
    collections: new Map(),
    countries: new Map(),
    genres: new Map(),
    people: new Map(),
  };

  // Apply the whole import atomically so a failed insert cannot leave partial data.
  db.exec("BEGIN");

  try {
    for (const library of data) {
      insertLibrary.run({
        id: library.id,
        title: library.title,
        type: library.type,
      });

      for (const name of library.collections) {
        getOrInsertId("collections", name, lookupIds.collections);
      }

      for (const item of library.items) {
        // Replace each item's links
        clearItemCollections.run({ item_id: item.id });
        clearItemCountries.run({ item_id: item.id });
        clearItemGenres.run({ item_id: item.id });
        clearItemPeople.run({ item_id: item.id });

        insertItem.run({
          id: item.id,
          library_id: library.id,
          rating_key: item.ratingKey,
          title: item.title,
          type: item.type,
          year: item.year ?? null,
          summary: item.summary ?? null,
          content_rating: item.contentRating ?? null,
          studio: item.studio ?? null,
          season_count: item.seasonCount ?? null,
          episode_count: item.episodeCount ?? null,
          show: item.show ?? null,
          season: item.season ?? null,
          episode: item.episode ?? null,
        });

        insertArtwork.run({
          item_id: item.id,
          poster: item.poster,
          background: item.background,
        });

        // Rebuild each item's many-to-many links from its latest Plex metadata.
        for (const name of item.collections) {
          const collectionId = getOrInsertId(
            "collections",
            name,
            lookupIds.collections,
          );
          insertItemCollection.run({
            item_id: item.id,
            collection_id: collectionId,
          });
        }

        for (const name of item.countries) {
          const countryId = getOrInsertId(
            "countries",
            name,
            lookupIds.countries,
          );
          insertItemCountry.run({
            item_id: item.id,
            country_id: countryId,
          });
        }

        for (const name of item.genres) {
          const genreId = getOrInsertId("genres", name, lookupIds.genres);
          insertItemGenre.run({ item_id: item.id, genre_id: genreId });
        }

        for (const person of item.people) {
          const personId = getOrInsertId(
            "people",
            person.name,
            lookupIds.people,
          );
          updatePersonProfile.run({
            person_id: personId,
            profile_picture: person.profilePicture ?? null,
          });
          insertItemPerson.run({
            item_id: item.id,
            person_id: personId,
            role: person.role,
            character: person.character ?? null,
          });
        }
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type LookupTable = "collections" | "countries" | "genres" | "people";

// Find a lookup record by name or insert it and return its ID.
function getOrInsertId(
  table: LookupTable,
  name: string,
  cache: Map<string, number>,
): number {
  // Reuse resolved IDs to avoid repeating the same lookup for every item.
  const cached = cache.get(name);

  if (cached !== undefined) {
    return cached;
  }

  const existing = db
    .prepare(`SELECT id FROM ${table} WHERE name = @name LIMIT 1`)
    .get({ name }) as { id: number } | undefined;

  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }

  const inserted = db
    .prepare(`INSERT INTO ${table} (name) VALUES (@name)`)
    .run({ name });

  const id = Number(inserted.lastInsertRowid);
  cache.set(name, id);

  return id;
}

await generateData(config.PLEX_URL, config.PLEX_TOKEN);
