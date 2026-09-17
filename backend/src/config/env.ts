/**
 * Loads the application's environment variables and uses zod to validate them.
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATA_PATH: z.string().default("/data"),
  PLEX_URL: z.url().min(1),
  PLEX_TOKEN: z.string().min(1),
});

let config: z.infer<typeof schema>;

config = schema.parse(process.env);

export { config };
