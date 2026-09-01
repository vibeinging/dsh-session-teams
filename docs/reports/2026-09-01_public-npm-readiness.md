# Public NPM readiness report

English | [中文](2026-09-01_public-npm-readiness.zh.md)

## Status

`@vibeinging/dsh-window-link@0.0.1` passes the repository release gate, creates a minimal public tarball, installs from that tarball in an empty project, and composes and boots with the official DSH `0.1.2-alpha.3` web profile. `npm publish` was intentionally not run.

## Published package contract

| Item | Value |
| --- | --- |
| Package | `@vibeinging/dsh-window-link` |
| Version | `0.0.1` |
| Registry | `https://registry.npmjs.org/` |
| Access | public |
| DSH feature SDKs | `0.1.2-alpha.3` |
| Cordis | `4.0.2` |
| Cordis loader | `1.0.3` |
| Schemastery | `3.18.2` |

The DSH feature packages use the exact Desktop-compatible alpha version. Cordis, the Cordis loader, and Schemastery are official foundation packages that do not publish a matching `0.1.2-alpha.3` version, so the package uses their current official compatible releases. The obsolete `@deepseek-ai/dsh-client-runtime` package is not used; DSH alpha 3 exposes client context and UI augmentation through Cordis and the renderer and session packages.

## Release gate

The check was run after a clean `pnpm@11.7.0 install --frozen-lockfile`:

```sh
npx --yes pnpm@11.7.0 run prepublishOnly
```

The gate passed repository rules, bilingual document pairing, lint, strict TypeScript checking, 7 test files with 28 tests, host and client builds, and the package dry-run smoke test. The host integration test uses the official alpha 3 `Context`, `AgentRegistry`, `Session`, `Inbox`, and user-message event shapes. It proves delivery between two active agents and rejection of an unauthorized target.

## Tarball evidence

An actual tarball was created with scripts disabled:

```sh
npm pack --json --ignore-scripts
```

| Field | Value |
| --- | --- |
| Filename | `vibeinging-dsh-window-link-0.0.1.tgz` |
| Packed size | 20,213 bytes |
| Unpacked size | 63,137 bytes |
| File count | 15 |
| SHA-1 | `e578f948c0d74c3387b4b9c76e49a961bfff0ac4` |
| Integrity | `sha512-X4Ko4s63SJvLVpL4vB2+UGHdsQB+bFrJtYwTa+xRk6LwCfDaz53/NMZnD07GR2z2eijpiaaxOlrnpvFRsMOQMw==` |

The tarball contains only `package.json`, `LICENSE`, both READMEs, `cordis.patch.yml`, the host JavaScript bundle, the client JavaScript bundle and source map, and generated type declarations. It contains no source files, tests, project notes, internal reports, or local configuration.

The tarball was then installed into an empty temporary project with npm. The host export and `dsh://session/123` serialization loaded successfully, the `./client` and `./cordis.patch.yml` exports resolved, and the official Cordis, agent, LLM, session, tools, and Schemastery runtime dependencies loaded.

## DSH alpha 3 profile evidence

The validation used the official `@deepseek-ai/dsh@0.1.2-alpha.3` executable and an isolated `DSH_HOME`. The local tarball was added to the `web` profile, `--dump-config` produced the composed plugin entry below, and the profile booted without opening a browser:

```yaml
- id: window-link
  name: '@vibeinging/dsh-window-link'
```

The web renderer returned HTTP 200 before the process was stopped. The launch token and temporary profile are not release inputs.

## Remaining acceptance boundary

This environment did not provide an instrumented DSH Desktop surface for creating two visible windows and clicking the action end to end. The executable host integration covers two live sessions, authorization, delivery, and rejection, while the final Desktop acceptance remains: open two DSH `0.1.2-alpha.3` windows, choose **Talk to another window**, paste the link into the other window, and send one task back to the linked active session.

The link authorizes only a session that is active in the same Host process and that supplied the exact link in a direct user message. It is sensitive and should be shared only with the intended window. The plugin does not provide a durable offline queue, cross-host routing, or delivery after the target session leaves the active agent registry.
