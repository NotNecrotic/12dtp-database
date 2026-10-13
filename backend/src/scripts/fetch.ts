import "@/db/schema.js";
import { config } from "@/config/env.js";
import { db } from "@/db/database.js";
import type { PlexLibrary, PlexLibraryItem } from "@/types/index.js";

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
}

const PAGE_SIZE = 1000;

function toId(value: string, name: string): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    throw new Error(`Plex returned an invalid ${name}: ${value}`);
  }

  return id;
}

function toAssetUrl(
  baseUrl: string,
  path: string | undefined,
  token: string,
): string | null {
  if (!path) {
    return null;
  }

  const url = new URL(path, baseUrl);
  url.searchParams.set("X-Plex-Token", token);

  return url.toString();
}

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

  return response.json() as Promise<T>;
}

async function fetchData(url: string, token: string): Promise<PlexLibrary[]> {
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

  const libraries = sectionList.filter(
    (
      library,
    ): library is PlexLibrarySection & { type: PlexLibrary["type"] } =>
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

    const items: PlexLibraryItem[] = [];

    let offset = 0;

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

      for (const item of pageItems) {
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
      items,
    });
  }

  return result;
}

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

  db.exec("BEGIN");

  try {
    for (const library of data) {
      insertLibrary.run({
        id: library.id,
        title: library.title,
        type: library.type,
      });

      for (const item of library.items) {
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
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

await generateData(config.PLEX_URL, config.PLEX_TOKEN);
