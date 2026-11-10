import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredDataDirectory = process.env.CLEARPDF_DATA_DIR?.trim();
process.env.CLEARPDF_DATA_DIR = path.resolve(configuredDataDirectory || path.join(projectRoot, ".data"));

await import("../.next/standalone/server.js");
