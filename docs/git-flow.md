# Git 流程

專案採 GitHub Flow：`main` 是唯一的長期分支，每項工作從 `main` 開短期分支，經 Pull Request 合回 `main`。沒有 `develop` 或 `release` 分支，也沒有版本 tag。多人（含 Codex、Claude Code 等代理）同時開發時，靠 issue 認領與 PR 描述交代範圍，避免互相覆蓋。

工作範圍與決策以 [GitHub issues](https://github.com/j10181996/my-lunch-town/issues) 為準，流程從認領 issue 開始。

## 一項工作的流程

```text
挑 issue → 加 process 標籤認領 → 從最新 main 開分支 → 開發與驗證
  → 推送並開 PR（Closes／Refs #N） → 合併到 main → 刪除分支 → 需要時重新部署 Sites
```

### 1. 認領 issue

開工前在 issue 加上 `process`（正在處理）標籤，讓其他人知道有人在做。先看有沒有開啟中的 PR 碰同一批檔案；有的話先協調，或等它合併後再從新的 `main` 開分支。

帶 `decision` 標籤的 issue 需要先做決定，不要直接動手實作。

### 2. 開分支

一律從最新的 `origin/main` 開分支：

```sh
git fetch origin
git switch -c feature/issue-21-store-invites origin/main
```

現有分支命名並不一致（`feature/issue-40-account-ui`、`feat/m3-store-hours`、`codex/18-mobile-controls`）。新分支建議用 `<類型>/issue-<編號>-<簡述>`：

| 類型 | 用途 |
| --- | --- |
| `feature/` | 新功能 |
| `fix/` | 修 bug |
| `docs/` | 只改文件 |
| `chore/` | 建置、依賴、設定 |

沒有對應 issue 的小改動可省略 `issue-<編號>`。由代理建立的分支可沿用工具預設前綴（如 `codex/`），但仍應帶上 issue 編號。

需要同時進行多項工作時用 `git worktree`，不要在同一個 checkout 來回切分支。

### 3. Commit

Commit message 用 Conventional Commits 前綴，描述用繁體中文：

```text
feat: 分開店家入口與一般使用者入口
fix: 團長開團時可選角色形象
docs: 新增開發指南與 CLAUDE.md
chore: establish verified lunch-town baseline
```

常用前綴：`feat`、`fix`、`docs`、`chore`、`refactor`、`test`。標題講結果，不講過程；需要解釋原因時寫在內文。一個 commit 只做一件事，不要混入無關的格式調整。

不要 commit 這些檔案（已在 `.gitignore`）：`data/`、`dist/`、`smoke-shots/`、`.wrangler/`、`worker/seed.bin`、`.env*`、各種 SQLite 檔。

### 4. 推送前驗證

推送前至少跑：

```sh
npm run typecheck
npm test
npm run build
```

目前沒有 CI，也沒有分支保護，這三項全靠開 PR 的人自己執行並寫進 PR 描述。動到流程或畫面時，再依 [開發指南的測試段落](development.md#測試) 跑對應的瀏覽器或 Sites 腳本。

### 5. 開 PR

PR 一律以 `main` 為目標。描述沿用既有 PR 的結構：

```markdown
（一段話：為什麼要做、解決什麼問題）

## 變更

- 使用者看得到的改變，以及動到的模組
- 明確說出「不包含」什麼，例如不改權限、不改 API

## 驗證

- 實際跑過的指令與結果（測試數量）
- 沒有跑的也要寫，例如「未執行 smoke.mjs」「未實機驗收」

Closes #42
```

連結 issue 的方式：

| 情況 | 寫法 | issue 狀態 |
| --- | --- | --- |
| PR 完成 issue 的全部範圍 | `Closes #N` | 合併後自動關閉 |
| 只完成一部分（例如黑客松展示子集） | `Refs #N` | 保持開啟、保留 `process`，在 PR 或交接文件說明還缺什麼 |

PR 若涉及資料庫 schema、新的 D1 binding 或 Worker 改動，描述中要特別註明，因為合併後 Sites 需要重新建置部署（見下方）。範圍較大、需要交接的工作另寫交接文件放在 `docs/`，例如 [M4 黑客松展示交接](m4-demo-handoff.md)。

### 6. 合併

目前同時允許 squash、merge commit 與 rebase，歷史上兩種都用過（#43 squash、#41 merge commit）。建議統一用 **Squash and merge**，讓 `main` 上一個 PR 對應一個 commit，標題沿用 PR 標題並保留 `(#編號)`。

合併前確認分支已跟上 `main`；落後時先 rebase 或合併 `main`，重跑上面的驗證。有衝突時由 PR 作者在自己的分支解決。

合併後刪除遠端分支（repo 未開啟自動刪除，需手動），本機的分支與 worktree 也一併清掉：

```sh
git push origin --delete feature/issue-21-store-invites
git worktree remove <worktree 路徑>
git branch -d feature/issue-21-store-invites
```

### 7. 部署

合併不會自動部署。Sites 由負責部署的人在 `main` 上執行 `npm run build` 後重新部署；PR 本身不操作雲端資源。部署行為與資料保存見 [README](../README.md#sites-完整功能部署)。

## 規則摘要

- 不直接推送 `main`，所有變更經 PR。
- 不 force push 別人的分支，也不 force push `main`。
- 一個 PR 對應一個 issue（或一組緊密相關的 issue），不要順手夾帶無關改動。
- PR 描述的驗證段落要誠實：沒跑的檢查要寫出來。
- 歷史規格檔（`development-spec.md`、`PLAN.md` 等）不在一般 PR 中修改。
