# 在新目录中恢复固定版本

本流程把 2026-09-30 的配置快照转换为一个可检查的隔离目录。默认动作是生成文件，不会安装软件、启动 DSH、读取 Keychain 或读取任何现有 `.credentials.yaml`。

恢复工具用 Node 标准库运行，无需先执行 `npm install`。本 PR 在 Node `24.19.0` / npm `11.9.0` / Linux 上验证了文件准备、失败路径、隔离安装，以及真实 DSH 的版本和合成配置导出；尚未在原 Mac 上启动整套恢复环境。原机已运行记录与本次恢复验收分开记录。

## 1. 生成新目录

在仓库根执行，目标必须不存在：

```sh
JERRY_RECOVERY="$PWD/../jerrydsh-recovery-0.2.0-rc.2"
node tools/recovery/recover.mjs prepare --target "$JERRY_RECOVERY"
node tools/recovery/recover.mjs check --target "$JERRY_RECOVERY"
```

不传 `--target` 时会在系统临时目录生成一个带时间戳的新目录。路径可以包含空格、引号、`#` 或冒号；生成器会正确引用 YAML 路径值。为了让目标边界清楚，显式给出的路径不能经过符号链接，不能位于当前 `~/.dsh` 或当前 `DSH_HOME` 中。

第二次对同一个目标运行 `prepare` 会拒绝执行，不会合并、覆盖或清理其中的文件。需要重做时使用另一个新目录。

如果已有原四业务模块的后端项目，可附加：

```sh
node tools/recovery/recover.mjs prepare \
  --target "$PWD/../jerrydsh-recovery-with-backends" \
  --projects-root "/absolute/path/to/your/projects"
```

`--projects-root` 只生成路径映射，不会读取这些后端的内容，不会克隆、启动或修改它们。现有布局沿用快照：`aircraft-comac/civair-kb`、`aircraft-comac/COMAC_FMEA_FTA_Manager_8024`、`jerry-personal/JerryDSH-COMACBench`。后端仓库的位置、版本、数据集和运行环境仍需独立登记。

生成目录包含：

```text
recovery.json                         文件 SHA-256、原快照 SHA、固定版本
environment.json                      仅路径和本地服务地址，不含凭证
npmrc                                 独立 npm 配置，无凭证
runtime/package.json                  @deepseek-ai/dsh 精确 0.2.0-rc.2
runtime/package-lock.json             本次解析并入仓的完整依赖锁
dsh-home/profiles/web/                原 web 配置、原锁文件和改写后的 patch
dsh-home/profiles/headless/           补全的 manifest、空依赖锁和 patch
dsh-home/profiles/fr-guard/           从 web 锁提取的固定依赖闭包
dsh-home/plugins/                     自有插件和 Skill 文件
dsh-home/mcp/zai-websearch/            搜索桥与精确 SDK 依赖锁
```

源仓库中的模型、provider、主题和业务插件选择保持原样。生成器只重写快照中的机器路径，将旧 `mcp/zai-mcp` 统一为 `mcp/zai-websearch`；不会复制 `.credentials.yaml`、`.env`、私钥、隐藏目录或 `node_modules`。根 README 的旧 `@latest` 恢复命令应由本流程替代。

## 2. 看清预检的含义

`check` 的 `ok: true` 表示**生成文件、依赖锁、目标边界和三套隐私双禁的静态检查通过**。它不表示 DSH 已成功启动、后端服务可用或网络外发已被动态验证。

报告会明确列出：

- 固定 DSH 版本以及是否检测到对应的已安装包；
- 每个 profile 的 `session-log-deepseek` 与 `session-telemetry-otel` 两条禁用项；
- Git 依赖来源与固定 commit；
- 缺失的后端路径项；
- 尚需运行验证的边界。

每次检查只读取准备时登记的文件。它不会扫描目标后来添加的凭证文件。登记文件被修改、移走或变成符号链接会导致预检失败；要保留一套新的配置基线，请修改受版本管理的源配置后生成新目标。

## 3. 按组件显式安装

只有 `install` 子命令安装依赖，而且必须明确选择组件。它使用隔离目录中的 `npm ci`，不做全局安装，不访问原 profile，不调用 DSH。每次安装前先核对已准备文件与锁。

```sh
# 装固定版本的宿主；这是单独的显式动作。
node tools/recovery/recover.mjs install --target "$JERRY_RECOVERY" --component runtime

# 按需要选择一个入口；不会自动安装所有 profile。
node tools/recovery/recover.mjs install --target "$JERRY_RECOVERY" --component headless
```

| component | 使用的版本依据 | 范围 |
| --- | --- | --- |
| `runtime` | `tools/recovery/locks/runtime` | DSH `0.2.0-rc.2` 及锁定的传递依赖，包含必需 peer |
| `headless` | 本仓 manifest + 空依赖锁 | 官方 `dsh-base` / `dsh-headless` bundle 由固定宿主提供 |
| `web` | 原 `profile-configs/web/package-lock.json`，原字节复制 | 现有 12 个第三方依赖；成功安装后严格应用 doctor 补丁 |
| `fr-guard` | 原 web 锁中的 `dsh-session-guard@4.0.0` 及依赖闭包 | 不重新解析范围或拉取 12 个 web 插件 |
| `zai-websearch` | `tools/recovery/locks/zai-websearch` | MCP SDK `1.30.0` 及锁定传递依赖 |

默认参数包含 `--ignore-scripts`，不会主动运行 npm 生命周期脚本。确有已审阅的包需要安装脚本时，可在该隔离组件安装命令后显式加 `--allow-scripts`。本 PR 的安装验证全都保留 `--ignore-scripts`；忽略安装脚本的目录也不能直接被认定为整套应用已通过验收。

`runtime` 使用 `--legacy-peer-deps=false`，其余快照组件沿用 `--legacy-peer-deps`。两者不能混用：`dsh-app-boot` 将必需的 `@deepseek-ai/cordis-plugin-group` 声明为 peer；对整个宿主使用 legacy 模式会漏装它，甚至 `dsh --version` 都无法加载。恢复预检显式拒绝缺少这个必需 peer 的 runtime 锁。

安装器使用目标中的 npm 配置与缓存，不传递模型 API key 或 SSH agent 环境变量。保留代理地址和已配置的 CA 证书路径，不关闭 TLS 校验。不会重赋 `HOME`，不会修改全局 npm/Git 配置。

### 原 web 锁不是纯 npm 镜像恢复链

web 锁中的多数归档来自 `registry.npmmirror.com`，其中一个依赖为：

```text
git+ssh://git@github.com/alaxrpg/dsh-llm-approve-for-me.git#f8af4295ca4a03f8e94de9f9a42cb10d59460190
```

生成器保留这个原始锁。安装器只在子进程中将公开 GitHub SSH URL 改走 HTTPS，保留同一 commit，不使用个人 SSH agent，也不改全局 Git 配置。仍需要 GitHub 与 npm 归档可访问；锁文件本身不包含离线归档。本流程尚不是完整的断网安装包。

runtime 与 MCP 的传递依赖锁是在本 PR 准备时以固定直接版本、`--package-lock-only --ignore-scripts` 解析后入仓的；runtime 启用标准 peer 解析，MCP 沿用 legacy 模式。这能让后续使用同一依赖图，但不能将这些新解析的传递版本冒称为原 Mac 的安装实测版本。锁生成阶段没有创建 `node_modules`；之后在独立目标中进行了显式安装验证。

## 4. doctor 补丁：全文件精确匹配

补丁仅适用于 `@linxin666/dsh-doctor@0.3.24`，从 client inject 数组移除已删服务 `settingsScope`，不改其余代码。依据和哈希记录在 `tools/recovery/baseline.json`。

已核对的 npm 归档：

<https://registry.npmjs.org/@linxin666/dsh-doctor/-/dsh-doctor-0.3.24.tgz>

其 SHA-512 与原 web lockfile 一致。`lib/client.js` 的 SHA-256 为：

| 状态 | SHA-256 |
| --- | --- |
| 原始文件 | `8eb17533dbb653195e70505211bf1ffb98a43edca2330a95baf12fe8436c3927` |
| 精确修补后 | `312ee077393af048421d8d4abd14010e619c03d5d5253fdead76473a752d9315` |

版本不符、前像哈希不符、片段出现次数不符、后像哈希不符，都拒绝写入。补丁保留 `.orig` 原始文件和 JSON 回执；重复执行只在原备份、修补文件与回执全部吻合时报告 `already-patched`。没有通用正则兜底或忽略失败的选项。

web 安装成功后会自动执行该限定补丁。若在隔离目录中单独核对/重应用：

```sh
node tools/recovery/recover.mjs patch-doctor --target "$JERRY_RECOVERY"
```

补丁使已知 client 依赖声明匹配当前基线；doctor 卡片和全部功能的运行行为仍需在隔离 DSH 启动后验证。

## 5. 启动信息与后端边界

```sh
node tools/recovery/recover.mjs launch-plan --target "$JERRY_RECOVERY"
```

这只输出 `command`、`args` 和该进程应使用的 `environment`，**不会启动服务**。其中使用官方支持的 `DSH_HOME` 和 `--profile web`，默认演示端口为 `3081`，不占用交接记录中的原 `3080`。将输出的环境仅应用到新进程；凭证由你在之后的独立运行验证中按既有方式管理，不能提交到本仓。

官方依据（固定源码）：

- [DSH_HOME 下的 profile 路径说明](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/README.md#L50)
- [官方 headless bundle 模板](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/profile.ts#L178-L193)

`environment.json` 显式覆盖旧四业务插件的原机默认路径。它们仍需要独立的 `civair-kb`、`JerryDSH-COMACBench`、`COMAC_Medini`、`COMAC_FMEA_FTA_Manager_8024` 服务/环境；ComfyUI 也不包含在本恢复目录中。搜索桥仍依赖 macOS Keychain，这次没有将它变成跨平台凭证实现。

## 验证与成熟度

运行不依赖网络、不执行第三方的回归测试：

```sh
node --test tests/recovery/*.test.mjs
```

测试覆盖新用户名和带空格/标点路径、源配置保持、锁文件原字节复用、重复 prepare 拒绝、符号链接与现有 home 拒绝、双禁缺失/重复/假值、文件漂移、显式安装范围、依赖闭包缺失，以及 doctor 版本/前后像匹配与重复执行。

### 本 PR 的实际恢复验证

验证在工作区内全新目录进行，保留了首轮失败目标与日志，最终使用修复后的新目标。没有安装到原 `~/.dsh`，没有读取 Keychain 或 `.credentials.yaml`，没有调用 LLM。

| 检查 | 结果 |
| --- | --- |
| Node 回归测试 | 12 项通过 |
| `runtime` 安装 | `npm ci --legacy-peer-deps=false --ignore-scripts` 成功 |
| `headless` / `fr-guard` 安装 | 原锁派生的配置依赖安装成功 |
| `web` 安装 | 原 web 锁安装成功，Git 固定 commit 未改变 |
| `zai-websearch` 安装 | SDK `1.30.0` 的锁定依赖安装成功；未启动桥或访问 Keychain |
| `dsh --version` | 精确输出 `0.2.0-rc.2` |
| 三套 `--profile … --dump-config` | 均退出 0；合成配置中两条隐私禁用均为 `true` |
| doctor 安装后修补 | 精确前像、后像校验通过；再次执行为 `already-patched` |

web 导出保留了一条原快照告警：`vision-toolkit` disable 指向当前 bundle 列表中不存在的 entry。该条禁用配置被保留，避免悄悄改变原先的禁用意图；它不影响双禁的合成结果。

`--dump-config` 的官方实现不会启动 profile，也不会求值 `!!js`；`--dump-default-config` 则省略用户 patch，不能替代本次双禁验证。这次结果证明锁版安装与配置合成可复现，仍未覆盖各第三方插件的激活、UI、后端、真实工程算例或联网搜索。

上述两个真实 CLI 检查已固化为 `probe`：

```sh
node tools/recovery/recover.mjs probe --target "$JERRY_RECOVERY" --component headless
node tools/recovery/recover.mjs probe --target "$JERRY_RECOVERY" --component fr-guard
node tools/recovery/recover.mjs probe --target "$JERRY_RECOVERY" --component web
```

省略 `--component` 时只检查 headless。它先确认 profile 所需 bundle 已安装，然后仅执行 `--version` 和 `--profile … --dump-config`，验证精确宿主版本与合成后的双禁。输出包含合成配置 SHA-256；除上面明确记录的原快照 `vision-toolkit` 告警外，出现其他诊断会失败。它不会执行任意任务或启动模型会话。

本工具的文件准备步骤有可复现实验，作为 **E1 Reproducible 的恢复工具**登记；整套宿主、插件和后端组合仍需独立启动、Golden Case 与失败路径验证才能晋升 **E2 Verified**。本流程不据静态检查授予 **E3 Team-ready** 或 **E4 Production**。
