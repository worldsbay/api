# Release validation

Version 0.1.0 is checked with `npm run check`: package build, HTTP and session tests, room protocol tests, asset manifest validation, upload safety tests, and an isolated package consumer.

The consumer verifies Node imports, NodeNext and bundler declarations, and browser/server bundle boundaries. Credentials and character binaries are excluded from the npm archive.

The public asset host is https://assets.worldsbay.com. Its backing R2 bucket retains its existing internal name; it is not a public product identifier.
