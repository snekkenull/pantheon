import path from "node:path";

import { loadAgentsFromDirectory, saveStore } from "../server/store.js";

const targetDirectory = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(process.cwd(), "examples", "agents");

const agents = loadAgentsFromDirectory(targetDirectory);

saveStore({
  updatedAt: new Date().toISOString(),
  agents,
});

console.log(`Imported ${agents.length} consciousness files from ${targetDirectory}`);

