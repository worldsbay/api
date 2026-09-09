# WorldsBay asset delivery

The API repository owns delivery tooling; the npm archive contains no assets, upload credentials or cloud SDK. Source character files remain in the main application asset library.

## Target

`config.json` contains the public asset domain and bucket name. Operators set `accountId` and any deployment overrides in the ignored `config.local.json`; this local file is merged over the shared configuration. Keep deployment reports in ignored `*.local.json` files. Public origin: `https://assets.worldsbay.com`, bound directly to R2 as a Cloudflare custom domain. Only approved public character files and their license/provenance records belong in this bucket. Leave the public `r2.dev` development URL disabled.

Apply `cors.json` in the bucket Settings. Public GET/HEAD from any origin supports independently hosted games; writes remain authenticated. Add a Cloudflare Cache Rule matching only `http.host eq "assets.worldsbay.com"`: eligible for cache, respect origin cache-control. Immutable objects carry one-year cache headers and the latest manifest uses 60 seconds. Do not override the latest manifest's TTL with a long edge TTL.

Bind the public asset hostname as an R2 custom domain. Do not point a CNAME at r2.dev.

## Prepare a release

```sh
npm ci
npm run assets:prepare -- --source /absolute/path/to/characters
```

The source directory must contain the raw, URL-free `manifest.json`, its hash-named GLBs/PNGs, `provenance.json`, `source-map.json`, and original `licenses/*.txt` notices. Preparation verifies the canonical pack revision, each filename, byte length and SHA-256. It deduplicates references and copies an allowlist into the ignored `.r2-upload/<revision>/objects` directory. It never uploads the entire source tree. The adjacent `inventory.json` records exact object keys, hashes, types and cache headers, and is not a public object.

The initial snapshot is the modular character pack. Do not rewrite legacy item URLs or older saved character revisions until their own approved, verified assets are also in R2. Retain old immutable pack folders for saved recipes.

## Upload

Create an R2 S3 credential with **Object Read & Write**, restricted to `worldsbay-assets`; choose a short expiry for a one-time upload. Copy `.env.example` to the ignored `.env` and fill `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Do not commit these values. Ordinary package users need no R2 credential. The uploader explicitly supplies R2 credentials and does not use an unrelated default AWS profile.

Using the plan path printed by preparation:

```sh
npm run assets:upload -- --plan .r2-upload/<revision>/inventory.json --dry-run
npm run assets:upload -- --plan .r2-upload/<revision>/inventory.json
npm run assets:upload -- --plan .r2-upload/<revision>/inventory.json --publish-latest
```

The first upload stages all immutable assets, notices and the pinned manifest. `--publish-latest` additionally updates the current manifest after every other object is verified. All local files are rechecked before any network writes. Uploads are bounded to four concurrent requests, resume by skipping verified existing objects, refuse conflicting immutable content, use conditional writes, and verify metadata after each write. No bucket cleanup or deletions occur. The operator should serialize releases; latest manifest updates use the ETag observed before writing to avoid overwriting a concurrent edit.

## Verify and roll back

```sh
npm run assets:verify -- --plan .r2-upload/<revision>/inventory.json
npm run assets:verify -- --plan .r2-upload/<revision>/inventory.json --all
```

Verification checks public HTTPS, CORS, MIME types, cache headers, byte lengths and SHA-256. The default samples the latest and pinned manifests, a model, a thumbnail and a license; `--all` checks every object. Both check the browser preflight. Verification requires active Cloudflare DNS and the custom-domain TLS certificate.

To roll back, rerun `assets:upload -- --plan <previous-inventory> --publish-latest`. Keep old inventories in protected operator storage and old immutable cloud objects available. A latest-manifest change may take up to its 60-second cache lifetime to reach clients; pinned recipes keep their existing revision.

References: [R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/), [CORS](https://developers.cloudflare.com/r2/buckets/cors/), [S3 conditional operations](https://developers.cloudflare.com/r2/api/s3/api/), [uploading objects](https://developers.cloudflare.com/r2/objects/upload-objects/).
