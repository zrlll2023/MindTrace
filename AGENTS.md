# MindTrace AI 工作约定

本文件是仓库级强制说明。任何 AI 或自动化代理开始修改前，都必须先阅读本文件并核对当前 Git 状态。

## 分支硬约束（2026-10-14 用户明确指定）

- AI 或自动化代理只允许在 `architecture-governance` 分支进行修改。修改文件、暂存、提交或执行回滚前，必须用 `git branch --show-current` 确认当前分支；结果不完全等于 `architecture-governance` 时立即停止写入，不得自行换分支继续。
- 任何时候都禁止切换到 `main`，禁止修改本地或任何远端的 `main` 分支。不得向 `main` 提交、合并、变基、拣选提交、重置、强制更新、推送、删除或重建；不得合并或启用自动合并目标为 `main` 的 Pull Request。
- 不得通过其他 worktree、其他克隆、Git 引用命令、远端 API 或自动化流程绕过上述限制。发布、收尾、同步、回滚、测试通过或波次获批均不构成例外。
- `main` 仅可用于只读比较。收尾应停留在 `architecture-governance`，不得将改动集成到 `main`。下面关于稳定集成、发布及其他长期分支的说明，不构成 AI 操作这些分支的授权。
- 当前 `architecture-governance` 的上游为 `origin/main`；禁止不指定目标的 `git push`、`git push --all` 或 `git push --mirror`，避免误推主分支。未来若获准推送本分支，必须显式指定 `HEAD:refs/heads/architecture-governance`，不得以 `main` 为目标。

## 分支职责

- `main` 是稳定集成与版本发布分支。功能开发、重构和体验优化不得直接在 `main` 上进行，应通过独立分支和 Pull Request 合并。
- `refactor/ui-ux-redesign` 用于 UI/UX、主题、视觉规范和页面布局重构。
- `feat/usability-improvements` 用于实际使用流程、操作效率、反馈状态和易用性优化。
- 开始工作前必须执行 `git status -sb`、`git branch -vv` 和 `git log --oneline --decorate -5`，确认分支、工作区与基线符合任务范围。

## 分支命名规范

- AI 或自动化代理创建的分支名称直接由本次改动的业务主题决定，不使用任何前缀：不用 AI 工具名前缀（如 `codex/`、`opencode/`、`claudecode/`），也不用类型前缀（如 `feat/`、`fix/`、`refactor/`）。分支名应能看出改动要解决什么问题，而不是由哪个工具创建。
- 分支名称必须使用小写英文字母、数字和短横线，不使用中文、空格、下划线或大小写混写。
- 建议使用 2 到 6 个单词并控制在 50 个字符以内；先写功能或业务范围，再写要达到的具体目标。
- 一个分支只承载一个主要目标。需求目标彼此独立时，应分别创建分支，不得使用同一分支混合无关改动。
- 禁止使用 `test`、`temp`、`new`、`update`、`changes`、`work` 等无法说明范围和目标的模糊名称。
- `feat/`、`fix/`、`refactor/`、`docs/`、`test/`、`chore/` 等类型前缀仅用于维护者明确指定的长期或人工协作分支，AI 不得自行添加任何前缀。
- 新分支应从最新且干净的目标基线创建；已合并分支不得直接复用来承载新的需求。
- 本规范生效前已经存在的分支保持原名，不为了统一格式重写远端分支历史。

推荐示例：

```text
profile-trend-visibility
report-export-settings
duplicate-import-guard
branch-naming-convention
```

不推荐示例：

```text
codex/profile-trend-visibility
opencode/branch-prefix-ownership-rule
feat/update
test
我的新分支
```

## 可用性分支同步要求

`refactor/ui-ux-redesign` 已经通过 Pull Request 合并到 `main`，`feat/usability-improvements` 也已同步该合并提交。后续 AI 不得继续把当前可用性分支描述为缺少新版 UI。

当 `main` 后续合并新的 UI/UX 或其他公共改动时，在可用性分支继续开发前必须：

```bash
git status -sb
git fetch origin
git merge origin/main
```

合并前工作区必须干净。同步后应检查主题组件、页面结构和启动器是否已经来自最新 `main`，不要手工复制 UI 分支文件，也不要绕过 `main` 直接把两个功能分支混合。

每次开始工作都应比较当前分支与 `origin/main` 的提交关系；如果出现新的未同步合并，AI 必须明确说明差异，再决定同步或开展不依赖该差异的工作，不得依据旧备注猜测分支状态。

## 提交信息规范

- Commit 标题统一使用中文自然语言，默认不使用 `feat:`、`fix:` 等英文类型前缀，除非用户明确要求采用其他格式。
- 标题应采用“动作 + 功能或业务对象 + 主要结果”的结构，让人无需查看代码即可一眼看懂本次改动。常用动作包括“新增”“优化”“修复”“调整”“移除”“补充”和“重构”。
- 标题建议控制在 15 到 40 个汉字，一次提交只描述一个主要目标，末尾不加句号。
- 优先描述用户能够感知的行为和结果，不直接罗列文件名、类名、函数名或底层实现细节。
- 禁止使用“修改代码”“更新内容”“修复若干问题”“优化功能”等无法说明实际变化的模糊表述。
- 同一目标包含两个紧密相关的结果时，可以使用“并”连接；如果改动目标彼此独立，应拆分为多个提交。
- 需要补充说明时，第一行仍保持简明标题，空一行后再用中文短句说明关键行为、兼容性或验证结果。

推荐示例：

```text
优化生活趋势展示，隐藏未填写内容并增加日期范围切换
修复重复导入对话时产生相同知识记录的问题
调整报告导出流程，记住上次使用的保存位置
```

不推荐示例：

```text
feat: update MeView and labs
修改生活趋势代码
修复若干问题
```

## 架构结构基线（新代码落位规则）

仓库在 `docs/superpowers/architecture/` 目录保存架构治理的结构基线，回答“新增的代码应该放在哪里、什么时候允许导出或删除”。

- 该目录的入口是 `docs/superpowers/architecture/README.md`，规则主体是 `docs/superpowers/architecture/structure-baseline.md`；动手新增共享类型、渲染层工具、IPC 域或大型页面逻辑前，必须先读这两份文件。
- 该目录是结构决策的**唯一权威出处**。开始任何结构治理或新增模块前，先按其中“新代码落位速查表”确定落位，不要凭目录名或习惯猜测。
- 其中记录的四项明确保留例外（`resetContext`、`AccountSummary`、`GenerateReportResult`、`SleepContent`）不得删除；扫描无引用不构成删除依据。
- 若实际代码与该基线冲突，以代码事实为准，并先向用户报告差异，再通过单独批准的波次更新基线；AI 不得自行放宽或改写基线规则。
- 修改该目录属于治理改动，必须先在 `architecture-governance` 分支完成并单独获批；不得与业务功能改动混在同一提交。

## 仓库卫生

- `.freebuff/`、`.workbuddy/`、`node_modules/`、`dist/`、`dist-electron/` 和 `release/` 都是本地元数据、依赖或构建产物，不得提交。
- 暂存前检查 `git status --short`、`git diff --cached --name-status` 和 `git check-ignore`，避免把本地工具文件、密钥或构建产物带入提交。
- 提交前按改动范围运行类型检查、测试和生产构建；已知失败必须报告，不得在未说明的情况下直接推送或合并。
