import path from "node:path";

export function getUploadsDirectory() {
  const configuredDataDirectory = process.env.CLEARPDF_DATA_DIR?.trim();
  const dataDirectory = configuredDataDirectory || path.join(process.cwd(), ".data");
  return path.resolve(dataDirectory, "uploads");
}
