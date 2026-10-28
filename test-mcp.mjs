#!/usr/bin/env node
/**
 * MCP 服务器自测：真的起进程、真的走 JSON-RPC、真的读返回。
 * 用法：node test-mcp.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cvstudio-test-"));
const srv = spawn("node", [path.join(HERE, "mcp-server.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CV_STUDIO_DATA: TMP, CV_STUDIO_OUT: TMP }
});

let buf = "";
const waiters = new Map();
srv.stdout.setEncoding("utf8");
srv.stdout.on("data", c => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    } catch { }
  }
});
srv.stderr.setEncoding("utf8");
srv.stderr.on("data", d => process.stderr.write("[server] " + d));

let seq = 1;
function rpc(method, params) {
  const id = seq++;
  return new Promise((res, rej) => {
    waiters.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => rej(new Error("timeout: " + method)), 15000);
  });
}
const call = (name, args) => rpc("tools/call", { name, arguments: args || {} });
const text = r => r.result.content[0].text;

const out = [];
function ok(label, cond, extra = "") {
  out.push(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
}

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
ok("initialize 握手", init.result?.serverInfo?.name === "cv-studio", init.result?.protocolVersion);
ok("声明 tools 能力", !!init.result?.capabilities?.tools);

const list = await rpc("tools/list", {});
ok("tools/list 返回 6 个工具", list.result.tools.length === 6, list.result.tools.map(t => t.name).join(","));

const g = await call("profile_get");
const prof = JSON.parse(text(g));
ok("profile_get 能读", !!prof.profile, (prof.profile?.name || "空") );

const set = await call("profile_set", { patch: { profile: { name: "测试者", role: "后端工程师" } } });
ok("profile_set 能写", JSON.parse(text(set)).ok === true);

const set2 = await call("profile_set", {
  patch: {
    experience: [{ org: "测试科技", role: "后端工程师", start: "2022.01", end: "至今", bullets: ["把接口 P99 从 800ms 降到 200ms"] }],
    skills: [{ group: "技术", items: ["Java", "MySQL"] }],
    target: { title: "后端工程师", jd: "招聘后端工程师，要求熟悉 Java、MySQL 与微服务，有高并发经验优先。" }
  }
});
ok("profile_set 能写数组", JSON.parse(text(set2)).ok === true);

const chk = JSON.parse(text(await call("resume_check")));
ok("resume_check 返回 6 项", chk.total === 6, `pass=${chk.pass}/6`);
ok("resume_check 关键词有结果", chk.keywords.total > 0, `rate=${chk.keywords.rate}% miss=${chk.keywords.miss.length}`);

const exp = JSON.parse(text(await call("resume_export", { format: "html" })));
ok("resume_export(html) 落盘", fs.existsSync(exp.path), exp.path);
const pdf = JSON.parse(text(await call("resume_export", { format: "pdf" })));
const pdfPath = pdf.path.endsWith(".pdf") ? pdf.path : "";
ok("resume_export(pdf) 落了 PDF", !!pdfPath && fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 3000,
   pdfPath ? (fs.statSync(pdfPath).size + " bytes") : (pdf.warning || ""));

const add = JSON.parse(text(await call("track_add", { company: "测试公司", skin: "serif" })));
ok("track_add 记账", add.ok === true);

const st = JSON.parse(text(await call("track_stats")));
ok("track_stats 统计", st.total >= 1, `total=${st.total} reliable=${st.reliable}`);
ok("样本不足会警告", st.total < 8 ? st.note.length > 0 : true);

const bad = await call("no_such_tool");
ok("未知工具返回错误而不崩", bad.result.isError === true, text(bad).slice(0, 20));

console.log(out.join("\n"));
srv.kill();
fs.rmSync(TMP, { recursive: true, force: true });
