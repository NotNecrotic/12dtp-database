import "@/db/schema.js";
import { config } from "@/config/env.js";
import { db } from "@/db/database.js";
import type { PlexLibrary, PlexLibraryItem } from "@/types/index.js";

interface PlexResponse {
  MediaContainer?: {
    size?: number;
    totalSize?: number;
    Metadata?: any[];
  };
}

const PAGE_SIZE = 1000;

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

  const sections = await plexRequest<PlexResponse>(
    `${baseUrl}/library/sections`,
    token,
  );

  const libraries = sections.MediaContainer?.Metadata ?? [];
  const result: PlexLibrary[] = [];

  for (const library of libraries) {
    const key = library.key;
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
          id: Number(item.ratingKey),
          libraryId: Number(key),
          ratingKey: String(item.ratingKey),
          title: item.title,
          type: item.type,
          year: item.year,
          summary: item.summary,
          contentRating: item.contentRating,
          studio: item.studio,
          seasonCount: item.childCount,
          episodeCount: item.leafCount,
          season: item.parentIndex,
          episode: item.index,
        });

        if (item.grandparentRatingKey) {
          item.show = Number(item.grandparentRatingKey);
        }
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
          id: Number(item.ratingKey),
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
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

await generateData(config.PLEX_URL, config.PLEX_TOKEN);
