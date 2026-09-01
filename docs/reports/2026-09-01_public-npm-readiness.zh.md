# 公开 NPM 发布准备情况报告

[English](2026-09-01_public-npm-readiness.md) | 中文

## 状态

`@vibeinging/dsh-window-link@0.0.1` 已通过仓库发布门禁，能够生成精简的公开发布 tarball，可以通过该 tarball 安装到空项目中，并能与官方 DSH `0.1.2-alpha.3` web profile 组合并启动。根据安排，未执行 `npm publish`。

## 发布包契约

| 项目 | 值 |
| --- | --- |
| 包 | `@vibeinging/dsh-window-link` |
| 版本 | `0.0.1` |
| 注册表 | `https://registry.npmjs.org/` |
| 访问级别 | 公开 |
| DSH 功能 SDK | `0.1.2-alpha.3` |
| Cordis | `4.0.2` |
| Cordis loader | `1.0.3` |
| Schemastery | `3.18.2` |

DSH 功能包使用与 Desktop 兼容且完全相同的 alpha 版本。Cordis、Cordis loader 和 Schemastery 是官方基础包，它们没有发布对应的 `0.1.2-alpha.3` 版本，因此本包使用这些基础包当前由官方发布的兼容版本。本包不使用已废弃的 `@deepseek-ai/dsh-client-runtime`；DSH alpha 3 通过 Cordis、渲染器包和会话包提供客户端上下文与 UI 扩展。

## 发布门禁

完成一次全新的 `pnpm@11.7.0 install --frozen-lockfile` 依赖安装后，运行以下检查：

```sh
npx --yes pnpm@11.7.0 run prepublishOnly
```

仓库规则、双语文档配对、lint、严格 TypeScript 检查、7 个测试文件中的 28 项测试、Host 与客户端构建，以及包的试运行冒烟测试均通过门禁。Host 集成测试使用官方 alpha 3 的 `Context`、`AgentRegistry`、`Session`、`Inbox` 和用户消息事件结构。该测试证明任务可以在两个活跃 agent（智能体）之间投递，并会拒绝未授权的目标。

## tarball 证据

通过以下命令禁用脚本并创建了实际 tarball：

```sh
npm pack --json --ignore-scripts
```

| 字段 | 值 |
| --- | --- |
| 文件名 | `vibeinging-dsh-window-link-0.0.1.tgz` |
| 打包大小 | 20,213 字节 |
| 解包大小 | 63,137 字节 |
| 文件数 | 15 |
| SHA-1 | `e578f948c0d74c3387b4b9c76e49a961bfff0ac4` |
| 完整性 | `sha512-X4Ko4s63SJvLVpL4vB2+UGHdsQB+bFrJtYwTa+xRk6LwCfDaz53/NMZnD07GR2z2eijpiaaxOlrnpvFRsMOQMw==` |

tarball 仅包含 `package.json`、`LICENSE`、两份 README、`cordis.patch.yml`、Host JavaScript bundle、客户端 JavaScript bundle 及 source map，以及生成的类型声明。它不包含源文件、测试、项目笔记、内部报告或本地配置。

随后使用 npm 将 tarball 安装到一个空的临时项目中。Host 导出项和 `dsh://session/123` 序列化功能均成功加载，`./client` 和 `./cordis.patch.yml` 导出项均可解析，官方 Cordis、agent、LLM（大语言模型）、会话、工具和 Schemastery 运行时依赖也均成功加载。

## DSH alpha 3 profile 证据

本次验证使用官方 `@deepseek-ai/dsh@0.1.2-alpha.3` 可执行文件和隔离的 `DSH_HOME`。系统将本地 tarball 添加到 `web` profile，`--dump-config` 生成如下组合插件配置项，随后 profile 在不打开浏览器的情况下成功启动：

```yaml
- id: window-link
  name: '@vibeinging/dsh-window-link'
```

停止进程前，Web 渲染器返回 HTTP 200。启动令牌和临时 profile 不属于发布输入。

## 剩余验收边界

此环境未提供具备自动化测试能力的 DSH Desktop 界面，无法创建两个可见窗口并端到端点击该操作。可执行的 Host 集成测试覆盖两个实时会话、授权、投递和拒绝路径；最后仍需在 Desktop 中验收：打开两个 DSH `0.1.2-alpha.3` 窗口，选择**跟另一个窗口对话**，将链接粘贴到另一个窗口，再将一项任务发送回链接指向的活跃会话。

该链接只会授权这样的会话：会话在同一 Host 进程中保持活跃，并且用户已在直接消息中提供该完整链接。该链接属于敏感信息，只应分享给预期窗口。本插件不提供持久化离线队列、跨 Host 路由，也不能在目标会话离开活跃 agent 注册表后继续投递。
