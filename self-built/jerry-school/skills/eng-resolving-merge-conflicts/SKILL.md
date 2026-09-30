---
name: eng-resolving-merge-conflicts
description: 解决进行中的 git merge/rebase 冲突：逐 hunk 按意图解决——意图追到各方一手来源（commit/PR/issue），能兼容就保留双方意图，不兼容按合并目标取舍，绝不发明新行为，永不 --abort。触发：merge 或 rebase 冲突已在进行中。
whenToUse: 冲突已在进行中才用；预防冲突不在此列。
---

# 解决合并冲突（Resolving Merge Conflicts）

1. **看当前状态**：merge/rebase 进行到哪了，查 git 历史与冲突文件。

2. **找每个冲突的一手来源**：深挖每处变更为何而来、原意图是什么。读 commit message、查 PR、查原始 issue/工单。

3. **逐 hunk 解决**：能兼容就保留**双方**意图；不兼容时选符合本次合并声明目标的一方，并记下 trade-off。**不发明新行为**。永远解决；**永不 `--abort`**。

4. **跑项目的自动检查**：通常 typecheck → tests → format。修掉合并弄坏的任何东西。

5. **完成 merge/rebase**：全部 stage 并 commit；rebase 则 `continue` 直到所有提交走完。

---
*改编自 Matt Pocock `resolving-merge-conflicts` 技能（MIT，github.com/mattpocock/skills）。*
