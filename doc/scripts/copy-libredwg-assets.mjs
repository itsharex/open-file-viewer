import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleEntry = fileURLToPath(import.meta.resolve("@mlightcad/libredwg-web"));
const packageRoot = dirname(dirname(moduleEntry));
const targetRoot = fileURLToPath(new URL("../public/vendor/libredwg-web/", import.meta.url));
const viewerEntry = fileURLToPath(import.meta.resolve("@mlightcad/cad-simple-viewer"));
const viewerRoot = dirname(dirname(viewerEntry));
const viewerDist = join(viewerRoot, "dist");
const viewerTarget = fileURLToPath(new URL("../public/vendor/cad-engine/", import.meta.url));

await Promise.all([mkdir(targetRoot, { recursive: true }), mkdir(viewerTarget, { recursive: true })]);
await Promise.all([
  cp(join(packageRoot, "dist"), join(targetRoot, "dist"), { recursive: true, force: true }),
  cp(join(packageRoot, "wasm"), join(targetRoot, "wasm"), { recursive: true, force: true }),
  copyFile(join(viewerDist, "libredwg-parser-worker.js"), join(viewerTarget, "libredwg-parser-worker.js")),
  copyFile(join(viewerDist, "mtext-renderer-worker.js"), join(viewerTarget, "mtext-renderer-worker.js"))
]);
