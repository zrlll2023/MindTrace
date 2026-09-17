# MindTrace AI 工作约定

本文件是仓库级强制说明。任何 AI 或自动化代理开始修改前，都必须先阅读本文件并核对当前 Git 状态。

## 分支职责

- `main` 是稳定集成与版本发布分支。功能开发、重构和体验优化不得直接在 `main` 上进行，应通过独立分支和 Pull Request 合并。
- `refactor/ui-ux-redesign` 用于 UI/UX、主题、视觉规范和页面布局重构。
- `feat/usability-improvements` 用于实际使用流程、操作效率、反馈状态和易用性优化。
- 开始工作前必须执行 `git status -sb`、`git branch -vv` 和 `git log --oneline --decorate -5`，确认分支、工作区与基线符合任务范围。

## 分支命名规范

- AI 或自动化代理创建的临时工作分支统一使用 `codex/<范围>-<目标>`，例如 `codex/profile-trend-visibility`、`codex/chinese-commit-guidelines`。
- 分支名称必须使用小写英文字母、数字和短横线，不使用中文、空格、下划线或大小写混写。
- `/` 后建议使用 2 到 6 个单词并控制在 50 个字符以内；先写功能或业务范围，再写要达到的具体目标。
- 一个分支只承载一个主要目标。需求目标彼此独立时，应分别创建分支，不得使用同一分支混合无关改动。
- 禁止使用 `test`、`temp`、`new`、`update`、`changes`、`work` 等无法说明范围和目标的模糊名称。
- `feat/`、`fix/`、`refactor/`、`docs/`、`test/`、`chore/` 等类型前缀仅用于维护者明确指定的长期或人工协作分支，AI 不得自行用这些前缀替代 `codex/`。
- 新分支应从最新且干净的目标基线创建；已合并分支不得直接复用来承载新的需求。
- 本规范生效前已经存在的长期分支保持原名，不为了统一格式重写远端分支历史。

推荐示例：

```text
codex/profile-trend-visibility
codex/report-export-settings
codex/duplicate-import-guard
```

不推荐示例：

```text
codex/update
codex/new_feature
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

## 仓库卫生

- `.freebuff/`、`.workbuddy/`、`node_modules/`、`dist/`、`dist-electron/` 和 `release/` 都是本地元数据、依赖或构建产物，不得提交。
- 暂存前检查 `git status --short`、`git diff --cached --name-status` 和 `git check-ignore`，避免把本地工具文件、密钥或构建产物带入提交。
- 提交前按改动范围运行类型检查、测试和生产构建；已知失败必须报告，不得在未说明的情况下直接推送或合并。
