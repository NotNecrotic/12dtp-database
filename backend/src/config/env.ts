/**
 * Loads the application's environment variables and uses zod to validate them.
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATA_PATH: z.string(),
});

let config: z.infer<typeof schema>;

config = schema.parse(process.env);

export { config };
