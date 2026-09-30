# 技能机制（eng-writing-for-agents 参考）

## 调用面选择

两个选择，交易两种负载：

- **model-invoked**（模型可调用）：保留 `description`，agent 可自主触发，别的技能也能到达。用户仍可敲名字调用——model-invocation 永远*包含*用户可达，description 只增不删。代价：description 是常驻 context pointer，每轮付费。机制：不写 `disable-model-invocation`（本插件：不写 `audience` 或写 `audience: model`），description 写成模型面指针（触发分支前置）。
- **user-invoked**（仅用户调用）：description 从 agent 视野剥离，只有人敲名字能调，其他技能也不能调。零 context load，但花 cognitive load：你是必须记得它存在的索引。机制：`disable-model-invocation: true`（本插件：`audience: user`）；description 变成人类面一行摘要。

只在 agent 必须自主到达、或别的技能必须到达时选 model-invocation。永远手敲的选 user-invoked，不付常驻负载。

**两个 user-invoked 技能共享的参考放不进任何一个**（没有 description，谁也调不了谁）——推到技能系统外的普通文件：任何技能都能指的外部参考。

## 按调用拆分

拆出一个 model-invoked 技能的条件：有一个独立的引导词该自己触发（你真在提示词里用的触发词），或别的技能必须到达它。新的常驻 description 是付费的，独立到达必须值这个价。

## Router 技能

用户技能多到记不住时，认知负载的解药是 **router**：一个用户技能点名其余技能和各自何时取用，人只记这一个。它只能指不能调——user-invoked 技能没有 description，除了人谁也够不着。

---
*源：mattpocock/skills `writing-for-agents/SKILL-MECHANICS.md`（MIT），翻译整合。*
