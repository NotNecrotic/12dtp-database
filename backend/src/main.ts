/**
 * Serves read-only JSON API routes for the media database.
 */

import "@/db/schema.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { config } from "@/config/env.js";
import { db } from "@/db/database.js";

interface PaginatedResult {
  data: unknown[];
  pagination: { limit: number; offset: number; total: number };
}

interface ItemListOptions {
  type?: string;
  sortColumn: "title" | "year";
  sortDirection: "ASC" | "DESC";
}

const API_PREFIX = "/api/v1";

// Hide "Not Rated" content ratings from API responses.
function hideUnratedContentRating<T extends { content_rating?: unknown }>(
  item: T,
): T {
  return typeof item.content_rating === "string" &&
    item.content_rating.trim().toLowerCase() === "not rated"
    ? { ...item, content_rating: null }
    : item;
}

// Route definitions returned by the API index endpoint.
const routes = [
  {
    method: "GET",
    path: `${API_PREFIX}`,
    description: "List available API routes.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/health`,
    description: "Check API and database status.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/items`,
    description: "Search and list items, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/items/:id`,
    description: "Get an item with artwork and metadata links.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/artwork/items/:id/:kind`,
    description: "Load item artwork through the API.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/collections`,
    description: "Search and list collections, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/collections/:id/items`,
    description: "Search and list items in a collection, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/genres`,
    description: "Search and list genres, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/genres/:id/items`,
    description: "Search and list items with a genre, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/countries`,
    description: "Search and list countries, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/countries/:id/items`,
    description: "Search and list items from a country, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/people`,
    description: "Search and list people, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/people/:id/items`,
    description:
      "Search and list items associated with a person, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/content-ratings`,
    description: "Search and list content ratings, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/content-ratings/:rating/items`,
    description:
      "Search and list items with a content rating, optionally paginated.",
  },
] as const;

// Shared table details let the related-data routes use the same handler.
const relationships = {
  collections: {
    // Table that stores the lookup values.
    table: "collections",
    // Join table and its lookup-table foreign key.
    junction: "item_collections",
    foreignKey: "collection_id",
  },
  genres: {
    table: "genres",
    junction: "item_genres",
    foreignKey: "genre_id",
  },
  countries: {
    table: "countries",
    junction: "item_countries",
    foreignKey: "country_id",
  },
  people: {
    table: "people",
    junction: "item_people",
    foreignKey: "person_id",
  },
} as const;

// Send a JSON response with the requested HTTP status.
function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

// Map an item row to include artwork URLs for the API response.
function mapItemArtwork(
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof item.id !== "number") {
    throw new Error("Item response did not include a numeric ID");
  }

  return {
    ...item,
    ...(typeof item.poster === "string" && {
      poster: `${API_PREFIX}/artwork/items/${item.id}/poster`,
    }),
    ...(typeof item.background === "string" && {
      background: `${API_PREFIX}/artwork/items/${item.id}/background`,
    }),
  };
}

// Load artwork from Plex and send it to the client, or return an error.
async function sendArtwork(
  response: ServerResponse,
  artworkUrl: string | null | undefined,
): Promise<void> {
  if (!artworkUrl) {
    sendJson(response, 404, { error: "Artwork not found" });
    return;
  }

  if (!config.PLEX_URL || !config.PLEX_TOKEN) {
    sendJson(response, 503, {
      error: "Plex URL and token are required to load artwork",
    });
    return;
  }

  const sourceUrl = new URL(artworkUrl);
  const plexUrl = new URL(config.PLEX_URL);
  if (
    sourceUrl.origin !== plexUrl.origin ||
    (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:")
  ) {
    sendJson(response, 502, {
      error: "Artwork URL does not match Plex server",
    });
    return;
  }

  for (const key of sourceUrl.searchParams.keys()) {
    if (key.toLowerCase() === "x-plex-token") {
      sourceUrl.searchParams.delete(key);
    }
  }

  const plexResponse = await fetch(sourceUrl, {
    headers: { "X-Plex-Token": config.PLEX_TOKEN },
    redirect: "error",
  });
  if (!plexResponse.ok) {
    sendJson(response, 502, {
      error: `Plex artwork request failed with status ${plexResponse.status}`,
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type":
      plexResponse.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(Buffer.from(await plexResponse.arrayBuffer()));
}

// Accept only positive integer IDs from route parameters.
function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Read and validate the optional limit and offset query parameters.
function pagination(url: URL): { limit: number; offset: number } | null {
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return null;
  }

  return { limit, offset };
}

// Read and validate the optional search term query parameter.
function searchTerm(url: URL): string {
  return (url.searchParams.get("q") ?? "").trim();
}

function escapedSearchPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

// Read and validate the optional item-list query parameters.
function itemListOptions(url: URL): ItemListOptions | null {
  const type = url.searchParams.get("type") ?? "";
  const sort = url.searchParams.get("sort") ?? "title";
  const order = url.searchParams.get("order") ?? "asc";

  if (
    (type && type !== "movie" && type !== "show") ||
    (sort !== "title" && sort !== "year") ||
    (order !== "asc" && order !== "desc")
  ) {
    return null;
  }

  return {
    ...(type ? { type } : {}),
    sortColumn: sort,
    sortDirection: order === "desc" ? "DESC" : "ASC",
  };
}

// Return true if the URL has any query parameters that indicate a paginated list request.
function hasListParameters(url: URL): boolean {
  return (
    url.searchParams.has("limit") ||
    url.searchParams.has("offset") ||
    url.searchParams.has("q")
  );
}

// Return a SQL WHERE clause from an array of conditions, or an empty string.
function whereClause(filters: string[]): string {
  const conditions = filters.filter(Boolean);
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

// Send a paginated result or an error message to the client.
function sendListResult(
  response: ServerResponse,
  result: PaginatedResult | null,
  errorMessage: string,
): void {
  sendJson(response, result ? 200 : 400, result ?? { error: errorMessage });
}

// Return a named-record page filtered against the full database result set.
function listRows(
  url: URL,
  columns: string,
  from: string,
  searchFields: string[],
  baseWhere = "",
  parameters: Record<string, number | string> = {},
  orderBy = "name",
): PaginatedResult | null {
  const page = pagination(url);
  const term = searchTerm(url);
  const sort = url.searchParams.get("sort") ?? "name";
  const order = url.searchParams.get("order") ?? "asc";
  if (
    !page ||
    term.length > 200 ||
    sort !== "name" ||
    (order !== "asc" && order !== "desc")
  ) {
    return null;
  }

  const filters = [baseWhere];
  const values: Record<string, number | string> = { ...parameters };
  if (term) {
    filters.push(
      `(${searchFields.map((field) => `${field} LIKE @search ESCAPE '\\'`).join(" OR ")})`,
    );
    values.search = escapedSearchPattern(term);
  }
  const where = whereClause(filters);

  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM ${from} ${where}`)
    .get(values) as { total: number };
  const data = db
    .prepare(
      `
      SELECT ${columns}
      FROM ${from}
      ${where}
      ORDER BY ${orderBy} COLLATE NOCASE ${order === "desc" ? "DESC" : "ASC"}, id
      LIMIT @limit OFFSET @offset
    `,
    )
    .all({ ...values, ...page });

  return { data, pagination: { ...page, total: count.total } };
}

// Return a page of items and its total count
function listItems(
  where: string,
  parameters: Record<string, number | string>,
  url: URL,
  personId?: number,
): PaginatedResult | null {
  // Validate pagination before using it in the SQL query.
  const page = pagination(url);
  const options = itemListOptions(url);
  const term = searchTerm(url);
  if (!page || !options || term.length > 200) {
    return null;
  }
  const filters = [where.replace(/^WHERE\s+/i, "")];
  if (options.type) filters.push("i.type = @type");
  if (term) {
    const searchFields = [
      "i.title LIKE @search ESCAPE '\\'",
      ...(personId === undefined
        ? []
        : [
            `
            EXISTS (
            SELECT 1 FROM item_people ip
            WHERE ip.item_id = i.id
              AND ip.person_id = @person_id
              AND ip.character LIKE @search ESCAPE '\\'
            )`,
          ]),
    ];
    filters.push(`(${searchFields.join(" OR ")})`);
  }
  const filteredWhere = whereClause(filters);
  const values: Record<string, number | string> = {
    ...parameters,
    ...(options.type ? { type: options.type } : {}),
    ...(term ? { search: escapedSearchPattern(term) } : {}),
    ...(term && personId !== undefined ? { person_id: personId } : {}),
  };

  // Return the total separately so clients can calculate page counts.
  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM items i ${filteredWhere}`)
    .get(values) as { total: number };
  // Include artwork when listing items so clients can render results directly.
  const rows = db
    .prepare(
      `
      SELECT i.*, a.poster, a.background
        ${
          personId === undefined
            ? ""
            : `,
          (SELECT ip.character
           FROM item_people ip
           WHERE ip.item_id = i.id AND ip.person_id = @person_id
           LIMIT 1) AS character`
        }
      FROM items i
      LEFT JOIN artwork a ON a.item_id = i.id
      ${filteredWhere}
      ORDER BY i.${options.sortColumn} COLLATE NOCASE ${options.sortDirection}, i.id
      LIMIT @limit OFFSET @offset
    `,
    )
    .all({
      ...values,
      ...(personId === undefined ? {} : { person_id: personId }),
      ...page,
    }) as Record<string, unknown>[];
  const data = rows.map((item) =>
    mapItemArtwork(hideUnratedContentRating(item)),
  );

  return {
    data,
    pagination: { ...page, total: count.total },
  };
}

// Load an item with its artwork and related collections, tags, and people.
function getItem(id: number): unknown | undefined {
  // Return no result when the ID is not present.
  const item = db
    .prepare(
      `
      SELECT i.*, a.poster, a.background
      FROM items i
      LEFT JOIN artwork a ON a.item_id = i.id
      WHERE i.id = @id
    `,
    )
    .get({ id }) as Record<string, unknown> | undefined;

  if (!item) {
    return undefined;
  }

  return {
    ...mapItemArtwork(hideUnratedContentRating(item)),
    collections: db
      .prepare(
        `
        SELECT c.id, c.name
        FROM collections c
        JOIN item_collections ic ON ic.collection_id = c.id
        WHERE ic.item_id = @id
        ORDER BY c.name COLLATE NOCASE
      `,
      )
      .all({ id }),
    genres: db
      .prepare(
        `
        SELECT g.id, g.name
        FROM genres g
        JOIN item_genres ig ON ig.genre_id = g.id
        WHERE ig.item_id = @id
        ORDER BY g.name COLLATE NOCASE
      `,
      )
      .all({ id }),
    countries: db
      .prepare(
        `
        SELECT c.id, c.name
        FROM countries c
        JOIN item_countries ic ON ic.country_id = c.id
        WHERE ic.item_id = @id
        ORDER BY c.name COLLATE NOCASE
      `,
      )
      .all({ id }),
    people: db
      .prepare(
        `
        SELECT p.id, p.name, ip.role, ip.character
        FROM people p
        JOIN item_people ip ON ip.person_id = p.id
        WHERE ip.item_id = @id
        ORDER BY ip.role, p.name COLLATE NOCASE
      `,
      )
      .all({ id }),
  };
}

// Match an incoming request to an API route and send its response.
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  // Split the URL into the path and its route segments.
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  // The index endpoint advertises routes for frontend development.
  if (path === API_PREFIX) {
    sendJson(response, 200, { routes });
    return;
  }

  if (path === `${API_PREFIX}/health`) {
    db.prepare("SELECT 1").get();
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (!path.startsWith(`${API_PREFIX}/`)) {
    sendJson(response, 404, { error: "Route not found" });
    return;
  }

  const [, , resource, idText, action] = parts;

  if (resource === "artwork") {
    if (parts[3] === "items" && parts.length === 6) {
      const id = parseId(parts[4] ?? "");
      const kind = parts[5];
      if (id === null || (kind !== "poster" && kind !== "background")) {
        sendJson(response, 400, { error: "Invalid artwork request" });
        return;
      }

      const row = db
        .prepare(`SELECT ${kind} AS url FROM artwork WHERE item_id = @id`)
        .get({ id }) as { url: string | null } | undefined;
      await sendArtwork(response, row?.url);
      return;
    }
  }

  if (resource === "items") {
    if (!idText && parts.length === 3) {
      const result = listItems("", {}, url);
      sendListResult(response, result, "Invalid pagination parameters");
      return;
    }

    if (idText && parts.length === 4) {
      const id = parseId(idText);
      if (id === null) {
        sendJson(response, 400, { error: "Invalid item ID" });
        return;
      }

      const item = getItem(id);
      sendJson(response, item ? 200 : 404, item ?? { error: "Item not found" });
      return;
    }
  }

  if (resource === "content-ratings") {
    if (!idText && parts.length === 3) {
      const result = listRows(
        url,
        "id, name, item_count",
        `(
          SELECT content_rating AS id, content_rating AS name,
            COUNT(*) AS item_count
          FROM items
          WHERE content_rating IS NOT NULL
            AND content_rating != ''
            AND LOWER(TRIM(content_rating)) != 'not rated'
          GROUP BY content_rating
        ) AS ratings`,
        ["name"],
      );
      sendListResult(
        response,
        result,
        "Invalid pagination or search parameters",
      );
      return;
    }

    if (idText && action === "items" && parts.length === 5) {
      let rating: string;
      try {
        rating = decodeURIComponent(idText);
      } catch {
        sendJson(response, 400, { error: "Invalid content rating" });
        return;
      }

      const exists = db
        .prepare(
          `SELECT 1 FROM items
           WHERE content_rating = @rating
             AND LOWER(TRIM(content_rating)) != 'not rated'
           LIMIT 1`,
        )
        .get({ rating });

      if (!exists) {
        sendJson(response, 404, { error: "Content rating not found" });
        return;
      }

      const result = listItems(
        "WHERE i.content_rating = @rating AND LOWER(TRIM(i.content_rating)) != 'not rated'",
        { rating },
        url,
      );
      sendListResult(response, result, "Invalid pagination parameters");
      return;
    }
  }

  // Keep related tables on the same generic list/detail-items handling.
  const relation = resource
    ? relationships[resource as keyof typeof relationships]
    : undefined;
  if (relation) {
    if (!idText && parts.length === 3) {
      if (hasListParameters(url)) {
        const result = listRows(
          url,
          resource === "people" ? "id, name, profile_picture" : "*",
          relation.table,
          ["name"],
        );
        sendListResult(
          response,
          result,
          "Invalid pagination or search parameters",
        );
        return;
      }

      if (resource === "people") {
        sendJson(
          response,
          200,
          db
            .prepare(
              "SELECT id, name, profile_picture FROM people ORDER BY name COLLATE NOCASE",
            )
            .all(),
        );
        return;
      }

      sendJson(
        response,
        200,
        db
          .prepare(
            `SELECT * FROM ${relation.table} ORDER BY name COLLATE NOCASE`,
          )
          .all(),
      );
      return;
    }

    if (resource === "people" && idText && !action && parts.length === 4) {
      const id = parseId(idText);
      if (id === null) {
        sendJson(response, 400, { error: "Invalid people ID" });
        return;
      }

      const person = db
        .prepare(
          `
          SELECT p.id, p.name, p.profile_picture,
            (
              SELECT COUNT(DISTINCT ip.item_id)
              FROM item_people ip
              WHERE ip.person_id = p.id
            ) AS item_count
          FROM people p
          WHERE p.id = @id
        `,
        )
        .get({ id }) as Record<string, unknown> | undefined;

      if (!person) {
        sendJson(response, 404, { error: "Person not found" });
        return;
      }

      const roles = db
        .prepare(
          `
          SELECT DISTINCT role
          FROM item_people
          WHERE person_id = @id
          ORDER BY role COLLATE NOCASE
        `,
        )
        .all({ id }) as { role: string }[];

      sendJson(response, 200, {
        ...person,
        roles: roles.map(({ role }) => role),
      });
      return;
    }

    if (idText && action === "items" && parts.length === 5) {
      const id = parseId(idText);
      if (id === null) {
        sendJson(response, 400, { error: `Invalid ${resource} ID` });
        return;
      }

      const exists = db
        .prepare(`SELECT id FROM ${relation.table} WHERE id = @id`)
        .get({ id });

      if (!exists) {
        sendJson(response, 404, { error: `${resource} not found` });
        return;
      }

      const where = `WHERE i.id IN (
        SELECT item_id FROM ${relation.junction} WHERE ${relation.foreignKey} = @id
      )`;
      const result = listItems(
        where,
        { id },
        url,
        resource === "people" ? id : undefined,
      );
      sendListResult(
        response,
        result,
        "Invalid pagination or search parameters",
      );
      return;
    }
  }

  sendJson(response, 404, { error: "Route not found" });
}

// Create and start the HTTP server to handle API requests.
const server = createServer((request, response) => {
  handleRequest(request, response).catch((error: unknown) => {
    console.error("API request failed:", error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    } else {
      response.destroy();
    }
  });
});

server.listen(config.PORT, "127.0.0.1", () => {
  console.log(
    `API server listening at http://127.0.0.1:${config.PORT}${API_PREFIX}`,
  );
});
