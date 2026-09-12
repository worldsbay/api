# Release preparation

Source repository: [worldsbay/api](https://github.com/worldsbay/api). The package is configured for public publication as `@worldsbay/api` on the npm registry. There is no automatic publish workflow.

When npm publication is requested:

1. Check the signed-in npm account's access to the `@worldsbay` scope and choose an unpublished version.
2. Review the MIT license carried from the existing developers repository and the package's API documentation.
3. Check the repository, homepage and issue URLs in package.json, then review and push the release commit.
4. Run `npm ci` and `npm run check` from a clean checkout, including CI on the intended supported Node versions. Inspect `npm pack --dry-run` and install the resulting archive in a real world integration.
5. After release approval, run `npm publish --access public --tag latest` and complete npm's two-factor verification. Verify the published version and install it from the registry. Prefer npm trusted publishing when configuring future release automation.

The current ESM exports, NodeNext declarations and package file allowlist follow [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) and [TypeScript library guidance](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html). No registry release or remote CI run is claimed by the local checks.

Version 0.1.0 includes guest entry, remembered sessions, hosted account navigation and the server-only `WorldClient.request(path, method, body?, grant?, options?)` adapter method. This method accepts only `/internal/` routes and preserves credential isolation, redirect rejection and timeout handling.

Version 0.1.1 removes the retired brand export and uses the WorldsBay request header.

Version 0.1.2 adds optional world avatar support and selected-style fields, avatar slot/central response types, avatar support schemas, and current detailed-character recipe fields. HTTP routes and client methods remain unchanged.
