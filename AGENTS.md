# `@tavyno/ts-sdk` rules

Read the shared rules first:

- [Shared principles](../ai-rules/principles.md)
- [Code conventions](../ai-rules/code-style.md)
- [Testing](../ai-rules/testing.md)
- [Safety](../ai-rules/safety.md)
- [Workflow](../ai-rules/workflow.md)
- [Package rules](ai-rules/package.md)

Before behavior changes or bug fixes, inspect the public contract, implementation, tests, dependency versions, and relevant scripts. Run `npm run check` and `npm run test:package` before completion.

Preserve cancellation and distinguish documented HTTP outcomes, transport failures, and invalid responses. Never add automatic retries without an explicit tested policy.

Use npm and commit generated lockfile changes; do not edit lockfiles by hand. Do not claim registry installation or release success unless verified.

This repo is API wrapper so this must not handle UI logic and must not be used in `rest-api`

# TypeScript client rules

- This package is a public, independently installable wrapper for Tavyno's REST API, consumed by web and React Native/Expo apps. Keep its scope limited to requested contracts.
- `rest-api` must never depend on this package. Check backend routes and tests before changing client methods, and synchronize wire contracts deliberately.
- Use a small Web Fetch API transport and explicit public wire contracts; do not couple this package to a server framework or its route types.
- Use Web Standard APIs only: no Node, Bun, filesystem, DOM, React, Next.js, or Worker-specific imports. Callers supply configuration and deployment URLs; the SDK does not read environment variables or embed credentials.
- Use Node's test runner with fake fetch boundaries. Packaging tests must verify the tarball, ESM, declarations, and web/mobile compatibility.
- Publish only through the approved GitHub release workflow using npm OIDC Trusted Publishing. Do not publish, push tags, or change registry/account configuration unless asked.
- Keep provider-specific SDKs, navigation, React hooks, token storage, and secure storage in hosts; the shared client owns provider-neutral OAuth/PKCE and API/session calls.
