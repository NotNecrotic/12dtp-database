/**
 * Creates the application's database schema.
 */

import { db } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS libraries (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL,
    rating_key TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    year INTEGER,
    summary TEXT,
    content_rating TEXT,
    studio TEXT,
    season_count INTEGER,
    episode_count INTEGER,
    show INTEGER,
    season INTEGER,
    episode INTEGER,

    FOREIGN KEY (library_id) REFERENCES libraries(id)
  );

  CREATE TABLE IF NOT EXISTS artwork (
    item_id INTEGER PRIMARY KEY,
    poster TEXT,
    background TEXT,

    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_collections (
    item_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,

    PRIMARY KEY (item_id, collection_id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS countries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_countries (
    item_id INTEGER NOT NULL,
    country_id INTEGER NOT NULL,

    PRIMARY KEY (item_id, country_id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_genres (
    item_id INTEGER NOT NULL,
    genre_id INTEGER NOT NULL,

    PRIMARY KEY (item_id, genre_id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_labels (
    item_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,

    PRIMARY KEY (item_id, label_id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_people (
    item_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    role TEXT NOT NULL,

    PRIMARY KEY (item_id, person_id, role),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );
`);
