# 本地提交检查与显式代码交付

范围：Python 标准库的可审查保护层；不上传文件，不调用供应商，不校验密钥是否有效，
不修改 Git 历史。模式/路径检查不能证明没有未知秘密，也不能判断真实 OA 的敏感性。
此工具不替代成熟的 secret scanner 和人的发布审查。

## 使用

从目标仓库根执行。`EXPECTED` 必须是你已经确认过的仓库绝对路径，不从当前目录自动猜。

```bash
EXPECTED=/absolute/path/to/intended-repository
python3 -S /absolute/path/to/JerryDSH-Assets/tools/security/preflight.py \
  --expected-root "$EXPECTED" --mode staged
```

`staged` 读取 Git 暂存对象而非工作区；已暂存的秘密不会因工作区后来修改而漏检。
`head` 检查当前 HEAD 整棵树。`range --base <40位SHA> --tip <40位SHA>` 检查每个中间
提交（新增后再删除仍被检测）；新分支用 40 个 0 作为 base，检查可达历史。超过 500 个
提交或 2000 个文件明确拒绝，不悄悄跳过。Git 读取失败返回 2，发现问题返回 1。
二进制、压缩包、数据库、凭证文件、运行目录、符号链接、子模块和超过 2 MiB 的文件
需要独立审查，不在本工具里静默放行。报告只输出路径/规则/提交，不输出命中值。

## 可选 Git hooks（本轮只交付，未在用户机器启用）

在本仓根核对 `git rev-parse --show-toplevel` 和 `git remote -v`（不要把含凭证的 URL
复制到日志）。检查已有 `git config --get core.hooksPath`；有自有 hooks 时先集成，
不要覆盖。确认后由用户/本地 Agent 执行：

```bash
git config --local dsh.expectedRoot /absolute/path/to/JerryDSH-Assets
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
```

hooks 可被 `--no-verify` 绕过，且只作用于这份 clone；GitHub App 写入不执行本地 hooks。
推送保护和独立 CI/服务器检查尚未配置。用于其他仓时需把工具、hooks 和测试经审查复制
到该仓，并为其设置自己的 expectedRoot；本 PR 不自动操作研究仓或仿真仓配置。

## civair-kb 代码交付（不收真实 OA）

仍未取得后端源码时，不创建替代实现。由本地 Agent 在其实际 `civair-kb` Git 根盘点
源码、依赖、测试、合成样例和原始合成评测记录，编写一个 JSON 数组，每项是明确文件：

```json
[
  {"path":"README.md","classification":"public-code"}
]
```

这是格式例子，不代表只有 README 就构成可验收交付。路径不得是目录或通配符。
按实际目录逐个列出 service/search/snapshot/govern、OA ingest、embedding seam、依赖、
smoke、合成样例及结果。classification 只能是 public-code、synthetic-fixture 或
redacted-evidence；归类和脱敏要由交付者审查，程序不替他证明授权。

```bash
# cwd 必须在实际后端仓库；工具在 Assets 仓，可以使用绝对路径调用。
python3 -S /absolute/path/to/JerryDSH-Assets/tools/security/preflight.py \
  --expected-root /absolute/path/to/civair-kb --mode export \
  --selection /outside/repo/reviewed-selection.json \
  --output /outside/repo/civair-kb-code-review.zip --reviewed-public
```

全部选中文件先检查再写包，输出必须在仓库外且不存在。父目录须预先建立。禁止复制整个
工作区、恢复目录或 Git 历史；逐层不跟随符号链接，检测读取时变化，输出精确字节摘要。
包内 `HANDOFF-MANIFEST.json` 给出源码 HEAD、工作区是否脏、每文件 SHA-256 和范围。
若工作区脏，HEAD 不能冒充包内修改的版本；按 manifest 的字节审查。打包不等于测试通过。
本工具仅支持 UTF-8 文件；二进制测试样例用合成生成脚本重建，或单独授权审查。

测试：`python3 -m unittest discover -s tests/security -v`。所有测试凭证均为合成值。
