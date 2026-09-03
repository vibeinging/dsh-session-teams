# Public NPM readiness report

English | [中文](2026-09-01_public-npm-readiness.zh.md)

## Status

`@vibeinging/dsh-session-teams@0.1.0` targets the official DSH `0.1.2-alpha.4` SDK, builds a minimal public tarball, installs into the local `web` profile, and passes real Desktop messaging and team-state acceptance. This source version was not committed, pushed, or published by this work.

## Release candidate contract

| Item | Value |
| --- | --- |
| Package | `@vibeinging/dsh-session-teams` |
| Version | `0.1.0` |
| Registry | `https://registry.npmjs.org/` |
| Access | public |
| DSH feature SDKs | `0.1.2-alpha.4` |
| Cordis | `4.0.2` |
| Cordis loader | `1.0.3` |
| Schemastery | `3.18.2` |

The package uses only official NPM SDK packages. `SessionPersistence` supplies the durable conversation directory, `AgentRegistry` supplies live and resumed agents, `SessionTitleService` names created team windows, and the optional `SystemPrompt` service exposes bounded routing context. The plugin has no private connection graph, custom Session event vocabulary, or second persistence store.

## Release gate

The source gate uses the repository-pinned pnpm version:

```sh
npx --yes pnpm@11.7.0 run check
```

Repository rules, bilingual document pairing, lint, strict TypeScript checking, the focused test suite, Host and client builds, and the package smoke audit are the release boundary. Focused coverage includes the full Host-visible directory, exact-title cold resume, duplicate-title refusal, composer target insertion, direct and reply delivery through `steer()`, queued team assignments through `followup()`, open-ended v4 relays, legacy v3 parsing, atomic cross-member task graphs, unique exact-title team reuse, ambiguous-title rejection before side effects, known alpha.4 log-only team-state records with stable surface generation and earlier-snapshot replay, dependency dispatch, technical retry, manual reassignment, official Host inbox delivery, the team-first browser panel, and duplicate suppression.

## Tarball evidence

An actual tarball was created with scripts disabled:

```sh
npm pack --json --ignore-scripts
```

| Field | Value |
| --- | --- |
| Filename | `vibeinging-dsh-session-teams-0.1.0.tgz` |
| Packed size | 72,313 bytes |
| Unpacked size | 289,047 bytes |
| File count | 20 |
| SHA-1 | `7a00d878a8de99f24beee48e75104d0da0f2628b` |
| SHA-256 | `4cb5736aceab144844c25bdd4efec0568ed8549dd08cf6adf4d9018244930ee9` |
| Integrity | `sha512-CvJCEVF9VOXnqtq1oU9QsjbOw6hth6/fjkneWA/lCNpD877rrDSIzzXm8Hl4Wygxo0XjPvSBjjLjaryikokHiA==` |

The tarball contains only `package.json`, `LICENSE`, both READMEs, `cordis.patch.yml`, the Host and client bundles, the client source map, and generated type declarations. It contains no source files, tests, project notes, internal reports, or local configuration.

## DSH alpha 4 profile evidence

The tarball was installed into the local `web` profile with the DSH plugin command. The composed bundle remains:

```yaml
- id: session-teams
  name: '@vibeinging/dsh-session-teams'
```

The development Desktop restarted with that tarball and reported both the Server and DSH runtime ready. The header registered **Window collaboration**, and the standard conversation list remained the addressable directory. Ten existing relayed messages changed from title-prefixed standard bubbles into compact source cards without changing their Chat node kind. Selecting **From 数数·学生甲** changed the page from **两学生窗口数数** to the exact **数数·学生甲** conversation through the official Session Controller. Selecting **创建团队状态验收窗口** under **Other conversations** closed the panel, inserted `跟“创建团队状态验收窗口”说：` into the composer, and left the composer focused with its caret at the end. The ordinary human message retained the shipped Chat renderer. No production application or DSH source checkout was changed.

## Desktop acceptance

A test session containing the out-of-repository `window-team/state` event is refused by the official persistence catalog after restart. The implementation does not rewrite or delete that user log and skips the unreadable directory entry. New state uses a namespaced record with the known alpha.4 `team/task` envelope, so it remains reloadable without entering the model surface. Readable earlier plugin-source snapshots remain valid compatibility input.

In **Send acceptance message and wait for reply**, the model addressed **alpha.4 acceptance receiver** by title and sent “Please reply ALPHA4-ROUNDTRIP-OK.” The target accepted the message, finished its own turn, and used the same `send_window_message` tool to return `ALPHA4-ROUNDTRIP-OK`. The source had already become idle; the returned `steer()` message started a new source turn automatically, proving A to B to A delivery without a reply switch or round-trip limit.

In **Create team-state acceptance window**, `create_window_team` created **alpha.4 team-state acceptance** as an ordinary visible top-level conversation. The scheduler sent its first task with `followup()`, the member returned `TEAM-STATE-OK` through `send_window_message` with `task_outcome: completed`, and the leader reached `1 / 1` on the first attempt. After a full development-App restart, the leader conversation loaded normally and the Window collaboration panel still showed one completed member, zero active tasks, and `1 / 1` progress.

The original counting request was repeated unchanged in **两个窗口协作数数到十**. The model called `create_window_team` after 15.837 seconds, once, with ten ordered tasks in one cross-member graph. The tool reused the unique existing **聪明1** and **聪明2** conversations, created no replacement windows, and the scheduler completed all ten alternating tasks with no failure. The leader log contains 31 append-only namespaced `team/task` states, zero plugin-surface snapshots, zero surface replacements, and only the normal `initial` and `resume` request headers. The final browser status reported an 89 percent prompt-cache hit.

## Remaining acceptance boundary

The plugin does not queue while the Host is stopped, cross a Host boundary, stream transcripts, delete conversations, or infer completion from arbitrary text. Queue acceptance remains distinct from task completion. Public NPM installation of this exact `0.1.0` tarball remains a release action because `npm publish` was not run for it.
