# Engineering rules for @tavyno/api-client

This repository is the public TypeScript wrapper for Tavyno's REST API. It is
consumed by web and React Native/Expo apps. It is not a backend application.

## Scope and dependency direction

- Keep the surface scoped to health, identity/session, provider-neutral OAuth/PKCE, and optional calendar connection/sync contracts; add other endpoints only when requested.
- Consumers depend on this package. `rest-api` must never depend on this package.
- The REST API owns its HTTP contract. Check its routes and tests before changing
  client methods; synchronize the public wire contract deliberately.
- Use Eden internally with an explicit Elysia route type. Public declarations must
  not import private repository paths, Cloudflare bindings, database code, or
  backend implementation types. Keep the package independently installable.
- Use Web Standard APIs. No Node, Bun, filesystem, browser DOM, React, Next.js,
  or Worker-specific runtime imports in the client.
- Do not read environment variables or choose deployment URLs inside the SDK.
  Callers supply configuration. Never embed credentials or log response bodies.

## Mandatory test-driven development

For every behavior change or bug fix:

1. Inspect the current public contract, implementation, tests, and dependency versions.
2. Write the smallest test of observable behavior first.
3. Run it and verify it fails for the missing behavior, not broken setup/imports.
4. Implement the minimum change to pass.
5. Refactor only where the changed code needs it, keeping tests green.
6. Run `npm run check` and `npm run test:package` before completion.
7. Review the diff and report checks that could not run.

Use Node's test runner and fake the fetch boundary; no live API, staging database,
clock sleeps, or production infrastructure in normal tests. Test URL/method,
response contracts, HTTP failures, malformed payloads, and cancellation/network
failures. Test through public methods, not private helpers or call counts.
Packaging tests must install the tarball in an isolated consumer and verify ESM,
public declaration resolution, and web/mobile bundle compatibility.
Never weaken tests or types to pass a check. New tooling may be scaffolded before
behavior tests, but production behavior must follow red → green → refactor.

## Clean code and pragmatic OOP/SOLID

Prefer small functions, explicit inputs, guard clauses, descriptive domain names,
and plain typed objects. Use strict TypeScript; narrow `unknown` at external
boundaries rather than asserting untrusted JSON. No `any` or broad suppressions.
Represent mutually exclusive outcomes with discriminated unions.

Classes are optional. Use them when identity, state, configuration, or lifecycle
makes the API clearer; a configured function closure is sufficient for this SDK.
Do not introduce classes purely for namespacing or static methods.

Apply SOLID when it removes concrete complexity:

- Single responsibility: keep endpoint behavior cohesive; isolate transport only
  when multiple endpoints actually need the same policy.
- Open/closed: prefer composition for real extension needs, not speculative hooks.
- Liskov substitution: custom fetch implementations must honor fetch semantics,
  including response and rejection behavior.
- Interface segregation: expose focused client contracts; do not require callers
  to implement unrelated capabilities.
- Dependency inversion: inject fetch at the network boundary for deterministic
  tests; no DI container, abstract base client, repository, or service hierarchy.

Avoid generic request frameworks, automatic retries, authentication systems,
caches, global state, and feature flags unless the current task requires them.
Do not abstract similar code until it represents the same repeated concept.

## Organization and error behavior

Start flat. Split by endpoint or transport responsibility as the package grows.
Review cohesion near 300 lines; split files above 500 lines when they mix concerns.
Do not create dumping-ground helpers or one-file-per-trivial-function structures.
Keep exports intentional and document public behavior and compatibility changes.

Treat the network as unreliable. Distinguish documented HTTP outcomes from
transport failures and invalid responses. Preserve cancellation; do not swallow
errors. Consumers must bound request duration and handle rejected promises.
Never retry automatically without an explicit, tested retry policy.

## Packaging and releases

- Use npm and commit its generated lockfile; do not edit lockfiles by hand.
- Build distributable ESM and self-contained declarations. Publish only intended
  artifacts; verify the packed package without sibling repositories.
- Preserve web and React Native runtime compatibility; bundle-time checks are not
  a substitute for device testing when adding platform-sensitive behavior.
- Add dependencies only for a real requirement; inspect installed types/source and
  official version-matched documentation for uncertain library behavior.
- Run validation before release. Version tags must match package.json.
- Publish through the approved GitHub release workflow using npm OIDC Trusted
  Publishing. Never commit publishing credentials or bypass failed checks.
- Do not publish, push tags, or change registry/account configuration unless asked.
- Keep changes scoped; never claim registry installation or release success until
  it has actually been verified.


## Issue branches and pull requests

- Create a branch linked with `gh issue develop` for every issue being implemented, including subissues.
- Cross-repository issues need linked branches in each affected repository.
- Create subissue branches from the parent issue branch. Merge each completed subissue branch into its parent branch before opening the parent PR to `main`.
- Use distinct names such as `issue-2-auth-calendar` (parent) and `issue-2/authentication` (child); Git cannot store both a branch and nested refs with the same prefix.
- Link PRs to the relevant issue URLs, include verification evidence, and leave parent issues open until all required subissues and aggregate acceptance criteria are verified.

- Commit each completed, verified sub-feature separately. Keep commits small and cohesive; do not bundle an entire issue into one implementation commit.

- The shared client owns provider-neutral OAuth/PKCE, token exchange/refresh and Tavyno session/API calls. Keep provider-specific SDKs out. Hosts own navigation and secure storage and must supply the required standard Web APIs on mobile runtimes.
