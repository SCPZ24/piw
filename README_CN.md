# piw

极轻量[Pi](https://pi.dev/) Profile管理器。

Pi会把插件都放进`~/.pi/agent/extensions/`和`~/.pi/agent/npm`。
用默认指令`pi`启动时，会一并启动所有插件，尽管当前任务并不需要某些插件。

piw可以把不同功能的pi插件组合包装成一个个pi profile。
每个profile就是一个预设的pi运行功能组合。

## 安装

```bash
npm install -g @scpz24/piw
```

要求：

* Node.js ≥ 22.19.0
* Pi ≥ 0.83.0
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

piw把每种组装项都视为一个entry,放在`~/.pi/piw`内。

Entry捕获方式：

对于插件/主题/提示词模板/技能，**直接放入`~/.pi/piw`**。

对于package，piw不会直接在目录中放入npm包，而是先用pi install把包放入pi的包目录中，然后用一个**软链接引用，形成一个Entry**。

添加方法：
```bash
piw add <package_name>
```
piw会先扫描pi是否已经安装该包；如果未安装，则先安装之。然后自动添加软链接。


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