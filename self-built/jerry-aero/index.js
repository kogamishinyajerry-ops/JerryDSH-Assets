/**
 * jerry-aero — 民机航空域聚合插件。
 *
 * modules/ 下每个子模块都是原子 cordis 插件（export name/inject/apply），
 * 本入口按序挂载，代码零改动平移。工具面前缀一览：
 *   civair_kb_*  知识底座检索/治理（sidecar 127.0.0.1:8791，自动拉起）
 *   comac_*      Benchmark Harness（薄代理 JerryDSH-COMACBench runners/）
 *   pdf_fta_*    PDF → medini-like 故障树（后端 127.0.0.1:8000）
 *   fmea_*       FMEA/FTA 受控文档库两道门（COMAC_FMEA_FTA_Manager_8024 CLI）
 *
 * 新增子模块三步：modules/ 放文件 → 此处 import → MODULES 列表加一行。
 * 2026-10 整编：合并自 dsh-kb-civair / dsh-comac-benchmark /
 * dsh-tool-pdf-fta / dsh-comac-suite(fmea 部分)，原件见 plugins.archive 或
 * 各自源仓库（civair-kb / JerryDSH-COMACBench 同步有源码副本）。
 */
import * as kbCivair from "./modules/kb-civair.js";
import * as comacBench from "./modules/comac-benchmark.js";
import * as pdfFta from "./modules/pdf-fta.js";
import * as fmeaGates from "./modules/fmea-gates.js";

export const name = "jerry-aero";
export const inject = ["tools"];

const MODULES = [kbCivair, comacBench, pdfFta, fmeaGates];

export function apply(ctx) {
  for (const m of MODULES) m.apply(ctx);
}
