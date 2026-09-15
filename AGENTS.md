# MindTrace AI 工作约定

本文件是仓库级强制说明。任何 AI 或自动化代理开始修改前，都必须先阅读本文件并核对当前 Git 状态。

## 分支职责

- `main` 是稳定集成与版本发布分支。功能开发、重构和体验优化不得直接在 `main` 上进行，应通过独立分支和 Pull Request 合并。
- `refactor/ui-ux-redesign` 用于 UI/UX、主题、视觉规范和页面布局重构。
- `feat/usability-improvements` 用于实际使用流程、操作效率、反馈状态和易用性优化。
- 开始工作前必须执行 `git status -sb`、`git branch -vv` 和 `git log --oneline --decorate -5`，确认分支、工作区与基线符合任务范围。

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

## 仓库卫生

- `.freebuff/`、`.workbuddy/`、`node_modules/`、`dist/`、`dist-electron/` 和 `release/` 都是本地元数据、依赖或构建产物，不得提交。
- 暂存前检查 `git status --short`、`git diff --cached --name-status` 和 `git check-ignore`，避免把本地工具文件、密钥或构建产物带入提交。
- 提交前按改动范围运行类型检查、测试和生产构建；已知失败必须报告，不得在未说明的情况下直接推送或合并。
