# Pi 1.0 极简适配计划

> 状态：文档方案，尚未实现。2026-10-02。
> 执行方式：按任务顺序在当前会话实现；未经用户要求不分派子代理。实施时可使用 `superpowers:executing-plans`，本轮仅更新文档。

**目标：** 让 Profile 能标记并加载 Pi 1.0 内置扩展，保持 piw 作为独立 npm 启动器的定位。

**架构：** 沿用 Entry → Profile → CLI argv → `execve`。在文件系统 Entry 旁加入一个静态内置扩展目录；运行时区分来源，持久化仍只有 Entry ID。所有资源解释与运行行为交给 Pi。

**技术：** 现有 TypeScript、Ink、Node.js、Vitest；不引入依赖，不接入 Pi SDK。

**产品契约：** [PRD.md](PRD.md)。原文件 `RPD.md` 本轮统一更名为 `PRD.md`；[release.md](release.md) 同步引用和下一版兼容基线。

## 1. 已确定的范围

- 用户已确认：直接要求 **Pi >=1.0.0**，不保留旧 Pi 兼容分支。
- piw 是独立 CLI/TUI，继续以 `@scpz24/piw` 经 npm 分发，安装入口仍为 `npm install -g @scpz24/piw`。
- 保留五种 Entry kind，不新增 MCP、Codemode、Virtual Model 等 Profile 模式。
- 内置扩展只标记和加载：不创建目录或软链接，不安装或复制其源码，不扫描 Pi 安装目录。
- 继续使用四个 `--no-*` 资源参数，以及现有资源透传限制。
- 不写 Pi settings、`mcp.json` 或凭据；不控制工具启用、模型路由、项目 trust、全屏模式或工作流；不自动补齐依赖。
- Node.js >=22.19.0、macOS/Linux、原子保存、`execve` 和本地资源规则沿用现有契约。

```mermaid
flowchart LR
    FS[本地目录与软链接] --> Entries[可选 Entry]
    Builtins[四个 Pi 内置标识] --> Entries
    Entries --> Config[piw config 勾选]
    Config --> State[piw.json 只存 Entry ID]
    State --> Args[资源参数编译]
    Args --> Exec[execve Pi]
    Native[Pi 原生配置与用户透传参数] --> Exec
    Exec --> Pi[Pi 决定工具启用与运行行为]
```

## 2. 对此前对话的取舍

保留“内置扩展可选、Profile 只存 ID、加载与启用分开”。收掉逐能力版本探测、自动依赖联选和通用资源提供者框架：本次只需要一个固定标识表。

此前对话中的 `piw dev -- -e builtin:mcp` **不是当前可用的临时方案**。`src/cli/args.ts` 会拒绝 `-e` 等资源透传，PRD 也要求资源集合由 Profile 决定；本次保持这一行为。

`PI_CODING_AGENT_DIR` 与 `resolvePiPackagePath()` 硬编码目录不一致的问题有源码依据，但属于既有 `piw add` 路径问题，另行处理。本次不改包定位，不宣称解决自定义目录下的包安装。

## 3. 最小设计

### 内置标识与运行时模型

在 `src/registry/builtins.ts` 定义四个固定标识：

| Entry ID | kind | Pi 参数 |
|---|---|---|
| `builtin:mcp` | extension | `-e builtin:mcp` |
| `builtin:codemode` | extension | `-e builtin:codemode` |
| `builtin:tool-search` | extension | `-e builtin:tool-search` |
| `builtin:llama.cpp` | extension | `-e builtin:llama.cpp` |

这些标识来自 [Pi v1.0.0 settings 文档](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/settings.md#resources)。表只表达 piw 已知的可加载目标，不保证用户的 Pi 安装完整或第三方扩展兼容；实际加载错误交给 Pi。

`Entry` 增加运行时判别字段 `source: "filesystem" | "builtin"`。文件系统分支保留必需的 `registryPath`、`realPath`；内置分支没有这两个字段。沿用 `launchPath`：本地资源是绝对路径，内置资源是完整 `builtin:` 字符串。不要给内置资源伪造路径，也不要把所有路径字段简单改成可选字段。

保持 `discoverEntries(piwHome)` 只做文件系统发现，增加 `getBuiltinEntries(): ValidEntry[]` 返回固定目录。`snapshot` 和 `runDoctor` 都在现有发现结果中合并目录，再交给原有 `resolveProfiles`，避免两个入口对可用资源的理解不同。不新增联网发现或持久化目录。

### 状态与旧配置

下一版写入 `PiwStateV2`，结构仍是 `{version, profiles: {name: {entries}}}`。只增加内置引用语义，不增加 Profile 字段。

```json
{
  "version": 2,
  "profiles": {
    "dev": {"entries": ["worktree"]},
    "research": {"entries": ["builtin:codemode", "builtin:mcp", "builtin:tool-search"]}
  }
}
```

- `validateIdentifier` 与 Profile 命名规则保持不变。
- 增加 `validateEntryReference(value: string): boolean`，允许原本的本地 ID 或 `^builtin:[a-z0-9][a-z0-9._-]{0,63}$`。
- `validateState(input: unknown): PiwStateV2` 对 v1 按旧规则校验，随后在内存中转成 v2；v1 中的冒号引用仍是无效输入。v2 使用新引用规则。
- 未知但语法合法的 `builtin:future` 可以保留在状态中，由 resolver 判为 missing，相关 Profile 不可启动；配置界面允许移除。不要把整个状态文件判坏，也不要透传猜测的标识。
- 新建状态写 v2；现有状态只在用户明确保存配置时写回 v2。启动、读取、取消配置和更新资源均不触发迁移写入。
- 继续保留重复 ID 检查、自然排序、严格字段校验、原始文件 fingerprint 和并发保存检查；不新增迁移命令或长期备份文件。
- 新版可读 v1；旧版会拒绝 v2。发布说明必须说明这个降级限制。npm 包版本不与状态版本机械绑定。

### 加载、展示与更新

`compilePiArgs(entries, passthrough)` 沿用现有规则：四个资源禁用参数 → 按 ID 自然顺序生成资源参数 → 原样追加允许的透传参数。内置项同样用 `-e`，不对其 `launchPath` 做路径解析。

`piw config` 在同一列表展示内置项，标记 `Pi built-in`，新 Profile 默认均未勾选。提示文案：`Loads the extension; tool activation is controlled by Pi.` 勾选 MCP 不联选其他项。

`piw list` 用内置标识替代路径展示；`doctor` 将其标记为 `Pi built-in`，不对它执行 `stat`、Git/npm 检测或服务连接检查。`piw update` 在进入 updater 前过滤内置项，不增加新的更新器、状态类型或统计项。

加载和启用是两件事。Pi 的 `--tools` 会替换工具选择；piw 不推导该参数。用户仍可显式使用 `piw research -- --tools read,bash,edit,write,codemode`，由 Pi 解释。见 [Pi v1.0.0 CLI](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/cli.md#tool-options)。

## 4. 实施任务

按以下四步完成；复用现有测试，每步先补对应回归用例再修改代码。本轮文档更新不运行这些命令。

### 任务 1：状态与引用

**文件：** `src/domain.ts`、`src/state/state.ts`；调整 `src/app.tsx`、`src/profiles/resolve.ts`、`src/tui/config.tsx` 的状态类型引用；测试在 `tests/domain.test.ts`、`tests/state.test.ts`。

- [ ] 定义 `PiwStateV2` 和 `validateEntryReference`，实现上述 v1 读取、v2 保存规则；保留 `LoadedState.rawBytes` 和原文件 fingerprint。
- [ ] 覆盖 v1 无写入读取、v2 内置引用、未知引用、非法格式、重复 ID、未来版本拒绝，以及旧名称规则不被放宽。
- [ ] 覆盖显式保存升级、取消不写盘、并发外部修改仍拒绝覆盖；更新现有状态 fixture 的预期。
- [ ] 运行 `npx vitest run tests/domain.test.ts tests/state.test.ts`，要求全部通过。

### 任务 2：内置目录贯通加载和现有界面

**新增：** `src/registry/builtins.ts`。

**修改：** `src/domain.ts`、`src/registry/discovery.ts`、`src/app.tsx`、`src/tui/config.tsx`；将 `src/updater/updater.ts`、`src/updater/system.ts` 的输入类型收窄为有效文件系统 Entry。`src/launcher/launcher.ts` 的参数循环原则上无需重写。

**接口：** `getBuiltinEntries(): ValidEntry[]`；新增 `ValidFilesystemEntry`、`ValidBuiltinEntry` 分支，合称 `ValidEntry`。`resolveProfiles` 继续接收合并后的 `Entry[]`，无需知道来源细节。

- [ ] 本地发现产物增加 `source: "filesystem"`；目录函数返回四个 `source: "builtin"`、`kind: "extension"`、`launchPath === id` 的条目。
- [ ] 在 snapshot 与 doctor 中合并；内置项进入现有选择、解析和启动流程；在 doctor/update 调用文件系统更新器前按 source 分支处理。
- [ ] 更新 TUI 与 list 展示，保留未知引用的移除行为，不增加新页面。
- [ ] 扩充 `tests/registry.test.ts`、`tests/profiles-launcher.test.ts`、`tests/tui.test.tsx`、`tests/doctor.test.ts`、`tests/updater.test.ts`：四个精确目标、混合排序、空 Profile、不自动联选、未知引用、内置项不触发文件系统/更新器调用；旧本地更新与软链接行为仍成立。
- [ ] 在 `tests/cli-args.test.ts` 明确断言 `-e builtin:mcp` 透传被拒绝，`--tools`/`--exclude-tools` 原样保留；保持现有资源限制。
- [ ] 运行 `npm run validate`，要求类型、单元测试和构建通过。

### 任务 3：Pi 1.0 基线与真实兼容验收

**文件：** `src/launcher/launcher.ts`、`tests/profiles-launcher.test.ts`、`tests/doctor.test.ts`、`tests/pi-package.test.ts`、`scripts/smoke-helpers.mjs`、`scripts/pi-compat.mjs`、`.github/workflows/ci.yml`。

- [ ] 将 `MINIMUM_PI_VERSION` 改为 `1.0.0`；同步 fake Pi 的版本和相关预期，补低版本拒绝用例，不增加逐能力版本判断。
- [ ] CI 的 Pi 矩阵改为 `["1.0.0", "latest"]`。保留真实 Pi 对本地 extension、skill、prompt、theme、package 的现有检查。
- [ ] 在现有兼容脚本的隔离环境中增加：空 Profile、单独内置扩展、混合资源、v1 旧 Profile，以及显式工具透传场景。
- [ ] 分别证明“加载”与“启用”：用 RPC `get_commands` 观察所选 MCP/llama 扩展的命令；Codemode/tool-search 通过测试临时扩展在公开生命周期中读取 `pi.getAllTools()` 与 `pi.getActiveTools()`。测试扩展只属于临时 fixture，不进入 piw 产品或运行时依赖。公开接口依据见 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md#tool-exposure)。
- [ ] 隔离设置下，未选内置项不出现；仅加载 Codemode/tool-search 可观察到注册但未激活；显式 `--tools` 后观察到用户选择。不连接真实 MCP 服务、不下载模型、不发送模型请求；检查 Pi 原生配置 fixture 与 v1 状态字节未被 piw 改写。
- [ ] 运行 `npm run validate`、`npm run smoke`、`npm run compat:pi -- --pi-version 1.0.0` 和 `npm run compat:pi -- --pi-version latest`。成功启动不足以代替上述行为断言。

### 任务 4：npm 交付说明

**文件：** `README.md`、`README_CN.md`、`CHANGELOG.md`；按 `docs/release.md` 更新 `package.json`、`package-lock.json` 的发布版本。

- [ ] 说明 Pi >=1.0.0、Profile 选择内置项、加载与启用边界、v1/v2 保存和降级限制；删去任何资源透传绕过 Profile 的示例。
- [ ] 按现有发布策略评估最低 Pi 版本提高与状态升级的版本影响；保持包名、bin 和 npm 安装方式，不添加 Pi SDK 或将 piw 标记为 Pi 插件。
- [ ] 运行 `npm run pack:check` 与 `npm run smoke:tarball`，要求打包安装后的 CLI 行为通过；tarball fixture 覆盖内置引用编译，不能只验证旧本地 Profile。
- [ ] npm 发布是单独交付动作，本轮文档任务不执行发布。

## 5. 容易遗漏的验收边界

| 输入或操作 | 预期 | 所属任务 |
|---|---|---|
| 读取 v1 后退出或取消编辑 | 磁盘字节不变，旧 Profile 不增资源 | 1、3 |
| 配置里存在 `builtin:future` | 仅相关 Profile 不可用，仍可移除该引用 | 1、2 |
| 仅勾选 MCP | argv 只增加 MCP，不自动增加其他扩展或工具参数 | 2 |
| list、doctor、update 遇到内置项 | 不构造假路径、不检查源码、不更新 Pi | 2 |
| Pi 低于 1.0、或仅加载未启用工具 | 前者报版本错误；后者不误报为已启用 | 3 |

本次完成标准：用户能在现有配置页选择内置扩展，选择可保存、可移除、可显式加载；piw 的持久化状态仍只表达资源组合，所有运行策略仍由 Pi 掌握。
