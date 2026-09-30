# Fowler Smell 基线（eng-code-review 参考）

固定基线，对 diff 逐条比对。每条读法：*是什么* → *怎么修*。

- **Mysterious Name（神秘命名）**：函数/变量/类型的名字不揭示它做什么或装什么。→ 改名；起不出诚实的名字，说明设计混浊。
- **Duplicated Code（重复代码）**：同一逻辑形状在改动里多个 hunk 或文件出现。→ 抽出共享形状，两处调用。
- **Feature Envy（依恋别人）**：一个方法摸别的对象的数据比摸自己的还多。→ 把方法搬到它依恋的数据上。
- **Data Clumps（数据泥团）**：同样几个字段/参数总是结伴出现（一个类型想出生了）。→ 捆成一个类型，传它。
- **Primitive Obsession（基本类型偏执）**：用基本类型或字符串顶替值得拥有自己类型的领域概念。→ 给概念一个自己的小类型。
- **Repeated Switches（重复分支）**：对同一类型的同样 switch/if 级联在改动里反复出现。→ 换多态，或两处共享一个 map。
- **Shotgun Surgery（霰弹式修改）**：一个逻辑变更迫使 diff 里许多文件零散修改。→ 把一起变的聚到一个模块。
- **Divergent Change（发散式变化）**：一个文件/模块因几个不相关的原因被改。→ 拆分，让每个模块只因一个原因变。
- **Speculative Generality（投机泛化）**：为 spec 没有的需求加的抽象、参数、钩子。→ 删掉，内联回去直到真需求出现。
- **Message Chains（消息链）**：长的 `a.b().c().d()` 导航，调用方不该依赖。→ 在第一个对象后藏一步方法。
- **Middle Man（中间人）**：一个类/函数 mostly 只往下转发。→ 砍掉，直接调真目标。
- **Refused Bequest（拒绝继承）**：子类/实现者忽略或覆盖大部分继承来的东西。→ 放弃继承，用组合。

**再记两条约束**：仓库成文规范覆盖基线（规范明确认可的，压住对应 smell）；每条 smell 是标注的判断题（"疑似 X"），永不是硬违规。工具（formatter/linter/类型检查）已强制的内容跳过。

---
*源：mattpocock/skills `code-review/SKILL.md` smell 基线（MIT；其源 Martin Fowler《Refactoring》ch.3），翻译整合。*
