#!/usr/bin/env python3
"""生成 headless 直挂 overlay（simulation.persona + dsh_sim MCP + orchestrator）。

为什么需要本生成器：headless profile 栈没有 agent-preset-registry（preset 是
web 会话机制），一次性 headless 会话必须把仿真三件套直接插入 profile 层。
本脚本只做参数化渲染——文件入口用 --plugin-dir 的绝对 file: URL，其余内容与
仓库内脱敏模板 simulation.headless.patch.yml 一致。

用法（全部绝对路径；--dump-config 验证与实际运行是分开的两步）：

  python3 generate-headless-overlay.py \
    --plugin-dir /abs/path/to/dsh-home/plugins/dsh-sim-orchestrator \
    --output /abs/path/to/overlays/simulation.headless.local.yml \
    [--timeout-ms 180000] [--api-url http://127.0.0.1:8600/api/v1] \
    [--projects proj_a] [--api-timeout 60000]

生成后的独立验证（不启动 LLM/worker，不带任务参数）：
  dsh --profile headless --dump-config --patch <output> > composed.yml
实际运行（另行执行）：
  dsh --profile headless --patch <output> "<任务>"
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import quote

TEMPLATE = """# headless 直挂 overlay（由 generate-headless-overlay.py 生成；勿手改）。
# 工具范围与 web preset 一致；session-log-deepseek 与 session-telemetry-otel 显式禁用。
- insert:
    - id: simulation-persona
      name: '@deepseek-ai/dsh-persona'
      config:
        complete: true
        includeRuntimeContext: false
        prefix: >-
          You coordinate simulation work. Use sim_orchestrate for one bounded
          plan, prepare, execute or review stage, retaining the task and evidence
          references returned by dsh-sim. Preparation and run requests are asynchronous.
          Missing inputs and human authorization are explicit blockers. An engineering
          result is established by the service and its frozen evidence, never by an
          Agent's successful turn. Keep REAL, MOCK and NOT_RUN distinctions visible.
    - id: simulation-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dsh_sim
        transport: stdio
        command: !!js process.env.DSH_SIM_PYTHON
        args: ['-m', 'dsh_sim.mcp.server']
        env:
          DSH_SIM_API_URL: !!js process.env.DSH_SIM_API_URL || '__API_URL__'
          DSH_SIM_AGENT_PROJECTS: !!js process.env.DSH_SIM_AGENT_PROJECTS || '__PROJECTS__'
          FASTMCP_CHECK_FOR_UPDATES: 'off'
          FASTMCP_SHOW_SERVER_BANNER: 'false'
        failOnStartupError: true
        toolCallTimeoutMs: __API_TIMEOUT__
    - id: simulation-orchestrator
      name: __ENTRY__
      config:
        providerName: spawn
        serverName: dsh_sim
        maxDepth: 1
        stageTimeoutMs: __TIMEOUT_MS__
        maxInputBytes: 65536

- id: session-log-deepseek
  disabled: true
- id: session-telemetry-otel
  disabled: true
"""


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plugin-dir", required=True,
                    help="已安装插件副本目录（绝对路径，须含 index.js 与 cordis.patch.yml）")
    ap.add_argument("--output", required=True, help="生成的 overlay 输出路径（绝对路径）")
    ap.add_argument("--timeout-ms", type=int, default=180000,
                    help="sim_orchestrate stageTimeoutMs（1000–1800000；多步 MCP 链建议 600000）")
    ap.add_argument("--api-url", default="http://127.0.0.1:8600/api/v1")
    ap.add_argument("--projects", default="proj_a",
                    help="AGENT 身份项目集合默认值（显式环境变量可覆盖）")
    ap.add_argument("--api-timeout", type=int, default=60000, help="MCP 工具调用超时 ms")
    args = ap.parse_args()

    # ---- 全部校验先于任何写入 ----
    plugin_dir = Path(args.plugin_dir)
    if not plugin_dir.is_absolute():
        die(f"--plugin-dir must be an absolute path: {plugin_dir}")
    if not plugin_dir.is_dir():
        die(f"--plugin-dir does not exist or is not a directory: {plugin_dir}")
    index_js = plugin_dir / "index.js"
    if not index_js.is_file():
        die(f"index.js not found in --plugin-dir: {index_js}")
    if not (plugin_dir / "cordis.patch.yml").is_file():
        die(f"cordis.patch.yml not found in --plugin-dir (是否为插件副本根目录?): {plugin_dir}")

    output = Path(args.output)
    if not output.is_absolute():
        die(f"--output must be an absolute path: {output}")
    if output.resolve() == index_js.resolve() or output.resolve().is_relative_to(plugin_dir.resolve()):
        die("--output must not be inside --plugin-dir（不覆盖插件副本）")
    if not (1000 <= args.timeout_ms <= 1_800_000):
        die(f"--timeout-ms must be in [1000, 1800000]: {args.timeout_ms}")

    # file: 入口（绝对路径 → file URL；空格等安全转义）
    entry = index_js.resolve().as_uri() if hasattr(Path, "as_uri") else \
        "file://" + quote(str(index_js.resolve()))

    rendered = (TEMPLATE
                .replace("__API_URL__", args.api_url)
                .replace("__PROJECTS__", args.projects)
                .replace("__API_TIMEOUT__", str(args.api_timeout))
                .replace("__ENTRY__", json.dumps(entry))
                .replace("__TIMEOUT_MS__", str(args.timeout_ms)))

    if output.exists():
        prev = output.read_text(encoding="utf-8")
        if prev != rendered:
            die(f"--output already exists with different content: {output}\n"
                "（选择新的输出路径，或删除旧文件；不做静默覆盖）")
        print(f"already generated (identical): {output}")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
        print(f"written: {output}")

    print("\n下一步（两步分开；dump-config 不带任务参数、不启动 LLM/worker）:")
    print(f"  1) dsh --profile headless --dump-config --patch '{output}' > composed.yml"
          "   # 验证合成：应含 simulation 三件套与两项 disabled: true")
    print(f"  2) DSH_SIM_PYTHON=<venv>/bin/python DSH_SIM_API_URL=... dsh --profile headless "
          f"--patch '{output}' \"<任务>\"")


if __name__ == "__main__":
    main()
