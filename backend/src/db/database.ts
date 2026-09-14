/**
 * Initialises the application's SQLite database.
 * */

import Database from "better-sqlite3";
import path from "node:path";
import { config } from "@/config/env.js";

const dataDir = config.DATA_PATH;

const databasePath = path.join(dataDir, "database.db");

export const db: Database.Database = new Database(databasePath);

// Enable foreign key constraint enforcement.
db.pragma("foreign_keys = ON");

// Enable WAL mode for improved read/write concurrency.
db.pragma("journal_mode = WAL");
