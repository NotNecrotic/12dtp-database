/**
 * Loads the application's environment variables and uses zod to validate them.
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATA_PATH: z.string().default("/data"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PLEX_URL: z.string().default(""),
  PLEX_TOKEN: z.string().default(""),
});

const config = schema.parse(process.env);

export { config };
