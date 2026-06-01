/**
 * API entry: start Express server.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../.env") });
config({ path: resolve(here, "../../.env") });
config();

const { start } = await import("./server.js");
start();
