/**
 * Initialises the application's SQLite database.
 * */

import { DatabaseSync } from "@photostructure/sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/config/env.js";

fs.mkdirSync(config.DATA_PATH, { recursive: true });

const databasePath = path.join(config.DATA_PATH, "database.db");

export const db = new DatabaseSync(databasePath);

/*
 Enable foreign key constraint enforcement.
 Enable WAL mode for improved read/write concurrency.
*/
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL; 
`);
