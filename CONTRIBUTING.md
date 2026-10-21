# Contributing

Use the pinned Node.js **24.21.0** and npm **11.19.0** toolchain. Follow [development setup](docs/development.md) to install dependencies and run the local demo.

## Checks

Run checks appropriate to the change:

```sh
npm run check:references
npm run lint
npm run typecheck
npm test
npm run build
```

For the full check, including browser coverage:

```sh
npx playwright install chromium
npm run check
```

See [testing](docs/testing.md) for browser requirements, individual commands, and known failures. A successful documentation check does not establish an application or live-service test result.

Preserve authentication, private-answer isolation, explicit processing consent, and individual proposal approval. Keep synthetic test data separate from participant data and never commit credentials or private runtime configuration.

Repository-specific agent coordination rules remain in [AGENTS.md](AGENTS.md).
