# DWG runtime assets

The files below are committed so a checkout and the documentation deployment
can render DWG files without rebuilding or downloading runtime binaries first.
They are still reproducible by running:

```bash
corepack pnpm --filter @open-file-viewer/doc assets:dwg
```

## Sources

### `libredwg-web/dist` and `libredwg-web/wasm`

- Package: `@mlightcad/libredwg-web@0.7.4`
- License: GPL-3.0
- Exact package archive: https://registry.npmjs.org/@mlightcad/libredwg-web/-/libredwg-web-0.7.4.tgz
- Source repository and full license: https://github.com/mlightcad/libredwg-web

### `cad-engine`

- Package: `@mlightcad/cad-simple-viewer@1.5.9`
- Files: `libredwg-parser-worker.js`, `mtext-renderer-worker.js`
- Package license: MIT; see `cad-engine/LICENSE`
- Exact package archive: https://registry.npmjs.org/@mlightcad/cad-simple-viewer/-/cad-simple-viewer-1.5.9.tgz
- Source repository: https://github.com/mlightcad/cad-viewer

The DWG parser Worker incorporates LibreDWG code and must be distributed in
accordance with the applicable GPL terms. This file records the exact package
versions and corresponding source locations; it is not a replacement for a
license review.

## Updating

Update the pinned package versions and lockfile first, run the asset command,
review the upstream licenses, and commit the regenerated files together with
this source record.
