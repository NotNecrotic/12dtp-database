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

const API_PREFIX = "/api/v1";
// Default and maximum page sizes for item-list responses.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Route descriptions returned by the API index endpoint.
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
    path: `${API_PREFIX}/libraries`,
    description: "Search and list libraries, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/libraries/:id`,
    description: "Get a library.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/libraries/:id/items`,
    description: "Search and list items in a library, optionally paginated.",
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
    description: "Search and list items associated with a person, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/content-ratings`,
    description: "Search and list content ratings, optionally paginated.",
  },
  {
    method: "GET",
    path: `${API_PREFIX}/content-ratings/:rating/items`,
    description: "Search and list items with a content rating, optionally paginated.",
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

// Accept only positive integer IDs from route parameters.
function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Read and validate the optional limit and offset query parameters.
function pagination(url: URL): { limit: number; offset: number } | null {
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return null;
  }

  return { limit, offset };
}

function searchTerm(url: URL): string {
  return (url.searchParams.get("q") ?? "").trim();
}

function escapedSearchPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

function hasListParameters(url: URL): boolean {
  return (
    url.searchParams.has("limit") ||
    url.searchParams.has("offset") ||
    url.searchParams.has("q")
  );
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
): {
  data: unknown[];
  pagination: { limit: number; offset: number; total: number };
} | null {
  const page = pagination(url);
  const term = searchTerm(url);
  if (!page || term.length > 200) return null;

  const filters = [baseWhere];
  const values: Record<string, number | string> = { ...parameters };
  if (term) {
    filters.push(
      `(${searchFields.map((field) => `${field} LIKE @search ESCAPE '\\'`).join(" OR ")})`,
    );
    values.search = escapedSearchPattern(term);
  }
  const conditions = filters.filter(Boolean);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM ${from} ${where}`)
    .get(values) as { total: number };
  const data = db
    .prepare(
      `
      SELECT ${columns}
      FROM ${from}
      ${where}
      ORDER BY ${orderBy} COLLATE NOCASE, id
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
): {
  data: unknown[];
  pagination: { limit: number; offset: number; total: number };
} | null {
  // Validate pagination before using it in the SQL query.
  const page = pagination(url);

  const term = searchTerm(url);
  if (!page || term.length > 200) {
    return null;
  }
  const searchWhere = term
    ? `${where ? " AND" : " WHERE"} (
        i.title LIKE @search ESCAPE '\\'
        OR CAST(i.year AS TEXT) LIKE @search ESCAPE '\\'
        OR i.type LIKE @search ESCAPE '\\'
        OR i.content_rating LIKE @search ESCAPE '\\'
        ${personId === undefined ? "" : `
          OR EXISTS (
            SELECT 1 FROM item_people ip
            WHERE ip.item_id = i.id
              AND ip.person_id = @person_id
              AND ip.character LIKE @search ESCAPE '\\'
          )`}
      )`
    : "";
  const filteredWhere = `${where}${searchWhere}`;
  const values = {
    ...parameters,
    ...(term ? { search: escapedSearchPattern(term) } : {}),
    ...(term && personId !== undefined ? { person_id: personId } : {}),
  };

  // Return the total separately so clients can calculate page counts.
  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM items i ${filteredWhere}`)
    .get(values) as { total: number };
  // Include artwork when listing items so clients can render results directly.
  const data = db
    .prepare(
      `
      SELECT i.*, a.poster, a.background
        ${personId === undefined ? "" : `,
          (SELECT ip.character
           FROM item_people ip
           WHERE ip.item_id = i.id AND ip.person_id = @person_id
           LIMIT 1) AS character`}
      FROM items i
      LEFT JOIN artwork a ON a.item_id = i.id
      ${filteredWhere}
      ORDER BY i.title COLLATE NOCASE, i.id
      LIMIT @limit OFFSET @offset
    `,
    )
    .all({
      ...values,
      ...(personId === undefined ? {} : { person_id: personId }),
      ...page,
    });

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
    ...item,
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
function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
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
  if (path === API_PREFIX || path === `${API_PREFIX}/`) {
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

  if (resource === "libraries") {
    if (!idText) {
      if (hasListParameters(url)) {
        const result = listRows(
          url,
          "id, title, type",
          "libraries",
          ["title", "type"],
          "",
          {},
          "title",
        );
        sendJson(
          response,
          result ? 200 : 400,
          result ?? { error: "Invalid pagination or search parameters" },
        );
        return;
      }
      sendJson(
        response,
        200,
        db
          .prepare("SELECT * FROM libraries ORDER BY title COLLATE NOCASE")
          .all(),
      );
      return;
    }

    const id = parseId(idText);
    if (id === null) {
      sendJson(response, 400, { error: "Invalid library ID" });
      return;
    }

    if (action === "items" && parts.length === 5) {
      const result = listItems("WHERE i.library_id = @id", { id }, url);
      sendJson(
        response,
        result ? 200 : 400,
        result ?? { error: "Invalid pagination parameters" },
      );
      return;
    }

    if (!action && parts.length === 4) {
      const library = db
        .prepare("SELECT * FROM libraries WHERE id = @id")
        .get({ id });
      sendJson(
        response,
        library ? 200 : 404,
        library ?? { error: "Library not found" },
      );
      return;
    }
  }

  if (resource === "items") {
    if (!idText && parts.length === 3) {
      const result = listItems("", {}, url);
      sendJson(
        response,
        result ? 200 : 400,
        result ?? { error: "Invalid pagination parameters" },
      );
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
      if (hasListParameters(url)) {
        const result = listRows(
          url,
          "id, name, item_count",
          `(
            SELECT content_rating AS id, content_rating AS name, COUNT(*) AS item_count
            FROM items
            WHERE content_rating IS NOT NULL AND content_rating != ''
            GROUP BY content_rating
          ) AS ratings`,
          ["name"],
        );
        sendJson(
          response,
          result ? 200 : 400,
          result ?? { error: "Invalid pagination or search parameters" },
        );
        return;
      }
      sendJson(
        response,
        200,
        db
          .prepare(
            `
            SELECT content_rating AS id, content_rating AS name, COUNT(*) AS item_count
            FROM items
            WHERE content_rating IS NOT NULL AND content_rating != ''
            GROUP BY content_rating
            ORDER BY content_rating COLLATE NOCASE
          `,
          )
          .all(),
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
        .prepare("SELECT 1 FROM items WHERE content_rating = @rating LIMIT 1")
        .get({ rating });

      if (!exists) {
        sendJson(response, 404, { error: "Content rating not found" });
        return;
      }

      const result = listItems(
        "WHERE i.content_rating = @rating",
        { rating },
        url,
      );
      sendJson(
        response,
        result ? 200 : 400,
        result ?? { error: "Invalid pagination parameters" },
      );
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
        sendJson(
          response,
          result ? 200 : 400,
          result ?? { error: "Invalid pagination or search parameters" },
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
          SELECT p.id, p.name, p.profile_picture, p.birth_date, p.death_date,
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
      sendJson(
        response,
        result ? 200 : 400,
        result ?? { error: "Invalid pagination or search parameters" },
      );
      return;
    }
  }

  sendJson(response, 404, { error: "Route not found" });
}

// Convert unexpected handler errors into a logged server error response.
// Create the HTTP server and dispatch each request to the route handler.
const server = createServer((request, response) => {
  try {
    handleRequest(request, response);
  } catch (error) {
    console.error("API request failed:", error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(config.PORT, "127.0.0.1", () => {
  console.log(
    `API server listening at http://127.0.0.1:${config.PORT}${API_PREFIX}`,
  );
});
