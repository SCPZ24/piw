# piw

极轻量 [Pi](https://pi.dev/) Profile 启动器，通过 npm 分发的独立 CLI，本身不是 Pi 插件。

Pi 会发现本地资源、已配置的包和内置扩展。piw 禁用自动资源发现，并显式加载 Profile 所选的资源。

piw可以把不同功能的pi插件组合包装成一个个pi profile。
每个profile就是一个预设的pi运行功能组合。

## 安装

```bash
npm install -g @scpz24/piw
```

要求：

* Node.js ≥ 22.19.0
* Pi ≥ 1.0.0
* macOS / Linux

## 使用

### 启动

```bash
piw
```
然后，选择一个 Profile，就会启动对应配置的 Pi。

或者直接：
```bash
piw <profile>
```

### 添加Entry

pi自身有5种运行时组装项
- 插件
- 主题
- 提示词模板
- 技能
- package（上述4样的组合包）

piw 把每种组装项视为一个 Entry。本地 Entry 是 `~/.pi/piw` 下的目录或目录软链接；内置 Entry 不需要文件系统对象。

Entry捕获方式：

对于插件/主题/提示词模板/技能，**各自放入 `~/.pi/piw` 下的独立目录**，结构见下方示例。

对于package，piw不会直接在目录中放入npm包，而是先用pi install把包放入pi的包目录中，然后用一个**软链接引用，形成一个Entry**。

添加方法：
```bash
piw add <package_name>
```
piw 会先检查 Pi 的对应包目录是否已存在；如果未安装，则先安装之。然后自动添加软链接。


`piw/`的目录结构示例:
```text
~/.pi/piw/
├── piw.json
├── worktree/
│   └── index.ts
├── superpowers/
│   └── SKILL.md
├── review/
│   └── review.md
├── tokyo-night/
│   └── tokyo-night.json
└── [softlink]pi-web-access
```

`piw.json` 是 piw 唯一维护的状态文件，记录各个 Profile 持有哪些 Entry。

### 配置

使用
```bash
piw config
```
来打开profile控制面板。在这里添加或移除profile。
在profile配置页，选中一个profile会加载哪些扩展项。

### Pi 内置扩展

配置列表包含 `builtin:mcp`、`builtin:codemode`、`builtin:tool-search`、`builtin:llama.cpp`，标记为 **Pi built-in**。新 Profile 默认均不勾选；勾选只要求加载该扩展，不会联选依赖或启用工具。空 Profile 不加载任何受管资源。

工具启用、MCP 配置、凭据和模型行为仍由 Pi 控制。例如，在 `research` Profile 中选中 `builtin:codemode` 后：

```bash
piw research -- --tools read,bash,edit,write,codemode
```

`--tools` 替换 Pi 的完整工具选择；`--exclude-tools` 也原样透传。`-e` 等资源参数不能绕过 Profile，内置扩展必须在 `piw config` 中选择。`piw list` 显示内置标识，`piw doctor` 标记其内置来源，`piw update` 排除内置项。内置扩展随 Pi 自身更新。

### 状态兼容性

PIW 2.0 要求 Pi ≥ 1.0.0。读取旧版 v1 `piw.json` 不改写文件，也不改变 Profile 成员。新建状态和显式保存配置使用 v2，只新增 `builtin:` 引用语义，仍然只保存 Entry ID。启动、列出、诊断、更新资源或取消配置均不会改写 v1 状态。

旧版 PIW 会拒绝 v2 状态。如果需要降级，请在使用 PIW 2.0 保存之前自行保留 v1 状态副本。未知内置引用仍可在配置中看到并移除，仅使引用它的 Profile 无法启动。
