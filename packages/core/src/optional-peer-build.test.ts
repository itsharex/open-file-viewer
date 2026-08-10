// @vitest-environment node

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps optional CAD peers out of esbuild static resolution", async () => {
  const resolvedCadPeers: string[] = [];

  await expect(
    build({
      entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      logLevel: "silent",
      plugins: [
        {
          name: "missing-optional-cad-peers",
          setup(context) {
            context.onResolve({ filter: /^[^./]/ }, ({ path }) => {
              if (path.startsWith("@mlightcad/")) {
                resolvedCadPeers.push(path);
                return {
                  errors: [{ text: `Optional CAD peer must remain runtime-only: ${path}` }]
                };
              }

              return { path, external: true };
            });
          }
        }
      ]
    })
  ).resolves.toBeDefined();

  expect(resolvedCadPeers).toEqual([]);
});
