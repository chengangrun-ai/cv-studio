#!/usr/bin/env node
/**
 * cv(studio) MCP server —— 零依赖，stdio，JSON-RPC 2.0（换行分隔）
 *
 * 任何支持 MCP 的客户端接上就能读写简历：
 *   claude / cursor / codex / 自己的 agent
 *
 * 配置（Claude Desktop 的 claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "cv-studio": { "command": "node", "args": ["<绝对路径>/mcp-server.mjs"] }
 *   }
 * }
 *
 * 数据落在同目录的 data/profile.json，和网页版「导出 JSON」是同一个格式。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.CV_STUDIO_DATA || path.join(HERE, "data");
const PROFILE = path.join(DATA, "profile.json");
const OUT = process.env.CV_STUDIO_OUT || path.join(HERE, "out");

/* ---------------- 存储 ---------------- */
const EMPTY = {
  profile: { name: "", role: "", phone: "", email: "", city: "", years: "",
             birth: "", politics: "", hometown: "", summary: "", links: [] },
  education: [], experience: [], projects: [], skills: [],
  target: { title: "", jd: "" }, apps: []
};

function ensure() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(PROFILE)) fs.writeFileSync(PROFILE, JSON.stringify(EMPTY, null, 2), "utf8");
}
function read() {
  ensure();
  try { return JSON.parse(fs.readFileSync(PROFILE, "utf8")); }
  catch { return structuredClone(EMPTY); }
}
function write(d) {
  ensure();
  fs.writeFileSync(PROFILE, JSON.stringify(d, null, 2), "utf8");
  return d;
}
function merge(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      merge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

/* ---------------- 六项体检（和网页版同一套规则） ---------------- */
function checks(S) {
  const p = S.profile || {};
  const exp = (S.experience || []).filter(e => e.org || e.role);
  const dated = exp.filter(e => e.start && e.end);
  const hasSkills = (S.skills || []).some(s => {
    const it = Array.isArray(s.items) ? s.items.join("") : String(s.items || "");
    return it.trim().length > 0;
  });
  const A = [
    { ok: true, item: "单栏版式", why: "姓名与正文走同一条文本流" },
    { ok: true, item: "姓名在首块", why: "不放页眉，不会被画到文档末尾" },
    { ok: true, item: "有文字层", why: "打印导出，不是截图" }
  ];
  const B = [
    { ok: !!(p.name || "").trim(), item: "姓名已填", why: "" },
    { ok: exp.length > 0 && dated.length === exp.length, item: "每段经历有起止", why: exp.length ? `${dated.length}/${exp.length} 段完整` : "还没有经历" },
    { ok: hasSkills, item: "技能分组非空", why: "" }
  ];
  const all = [...A, ...B];
  return { pass: all.filter(x => x.ok).length, total: 6, layout: A, content: B };
}

const DICT = ["产品设计","交互设计","用户体验","用户研究","可用性测试","设计系统","视觉设计","数据分析","数据可视化","用户增长","项目管理","团队管理","需求分析","敏捷开发","前端开发","后端开发","全栈","算法","机器学习","深度学习","自然语言处理","计算机视觉","推荐系统","大数据","云计算","微服务","数据库","自动化测试","运维","安全","财务","审计","税务","会计","销售","市场","品牌","运营","内容运营","供应链","采购","物流","人力资源","招聘","培训","绩效","法务","合规","战略","咨询","投资","风控","客户成功","渠道","电商","直播","短视频","新媒体","文案","投放","转化率","留存","领导力","沟通","协作","英语","日语","公文写作","预算","成本"];
const STOP = new Set(["the","and","for","with","you","are","our","will","have","this","that","from","your","who","can","all","not","but","out","job","team","work","able","good","must","more","than","into","also","they","them","their","what","when","which","about","other","such","well"]);

function keywords(jd) {
  if (!jd) return [];
  const set = new Set();
  for (const w of DICT) if (jd.includes(w)) set.add(w);
  for (const w of (jd.toLowerCase().match(/[a-z][a-z0-9+#./]{2,}/g) || [])) {
    if (!STOP.has(w) && w.length <= 18) set.add(w);
  }
  return [...set];
}

function kwStats(S) {
  const jd = (S.target && S.target.jd) || "";
  const kws = keywords(jd);
  if (!jd.trim() || !kws.length) return { empty: true, rate: 0, hit: [], miss: [], total: 0 };
  const full = JSON.stringify(S).toLowerCase();
  const hit = kws.filter(k => full.includes(k.toLowerCase()));
  const miss = kws.filter(k => !full.includes(k.toLowerCase()));
  return { empty: false, rate: Math.round(hit.length / kws.length * 100), hit, miss, total: kws.length };
}

/* ---------------- 渲染（单栏，ATS 安全） ---------------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lines = v => Array.isArray(v) ? v : String(v || "").split("\n").map(s => s.trim()).filter(Boolean);

function renderHTML(S) {
  const p = S.profile || {};
  const sec = (t, inner) => inner ? `<section><h2>${esc(t)}</h2>${inner}</section>` : "";
  const bu = a => { const l = lines(a); return l.length ? `<ul>${l.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; };

  const edu = (S.education || []).filter(e => e.school || e.major).map(e =>
    `<div class="it"><div class="top"><b>${esc(e.school)}</b><span>${esc([e.start, e.end].filter(Boolean).join(" – "))}</span></div>
     <div class="sub">${esc([e.degree, e.major].filter(Boolean).join(" · "))}</div>${e.note ? bu([e.note]) : ""}</div>`).join("");

  const exp = (S.experience || []).filter(e => e.org || e.role).map(e =>
    `<div class="it"><div class="top"><b>${esc(e.org)}</b><span>${esc([e.start, e.end].filter(Boolean).join(" – "))}</span></div>
     <div class="sub">${esc(e.role)}</div>${bu(e.bullets)}</div>`).join("");

  const prj = (S.projects || []).filter(e => e.name).map(e =>
    `<div class="it"><div class="top"><b>${esc(e.name)}</b><span>${esc([e.start, e.end].filter(Boolean).join(" – "))}</span></div>
     <div class="sub">${esc(e.role)}</div>${bu(e.bullets)}</div>`).join("");

  const sk = (S.skills || []).map(s => {
    const it = Array.isArray(s.items) ? s.items : String(s.items || "").split(/[,，、]/);
    const t = it.map(x => String(x).trim()).filter(Boolean).join(" · ");
    return t ? `<div class="sk"><b>${esc(s.group || "技能")}</b><span>${esc(t)}</span></div>` : "";
  }).join("");

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(p.name)} · 简历</title>
<style>
@page{size:A4;margin:16mm 15mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:10.5pt;line-height:1.62;color:#20242b}
h1{font-size:21pt;margin:0 0 4px;font-weight:600}
.role{font-size:11pt;color:#1B365D;margin:0 0 6px;font-weight:500}
.meta{font-size:9pt;color:#5b6473;margin:0 0 14px}
h2{font-size:10.5pt;letter-spacing:.18em;color:#1B365D;margin:16px 0 6px;border-bottom:1px solid #cfd8e3;padding-bottom:4px;font-weight:600}
.it{margin-bottom:10px}
.top{display:flex;justify-content:space-between;font-size:10pt}
.top span{color:#7a8391;font-size:9pt}
.sub{color:#3d4756;font-size:10pt}
ul{margin:3px 0 0;padding-left:15px}
li{margin-bottom:2px;font-size:10pt}
.sk{display:flex;gap:12px;font-size:10pt;margin-bottom:3px}
.sk b{flex:0 0 80px;color:#1B365D}
p{margin:0}
</style></head><body>
<h1>${esc(p.name)}</h1>
${p.role ? `<p class="role">${esc(p.role)}${p.years ? " · " + esc(p.years) + "经验" : ""}</p>` : ""}
<p class="meta">${[p.phone, p.email, p.city].filter(Boolean).map(esc).join(" · ")}</p>
${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
${sec("教育背景", edu)}
${sec("工作经历", exp)}
${sec("项目经历", prj)}
${sec("技能", sk)}
</body></html>`;
}

function tryPDF(htmlPath, pdfPath) {
  const cands = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium"
  ];
  const exe = cands.find(c => { try { return fs.existsSync(c); } catch { return false; } });
  if (!exe) return { ok: false, reason: "找不到 Chrome，已只输出 HTML，用浏览器打开后打印即可" };
  const r = spawnSync(exe, ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, "file:///" + htmlPath.replace(/\\/g, "/")],
    { timeout: 60000 });
  const ok = fs.existsSync(pdfPath);
  return { ok, reason: ok ? "" : "Chrome 调用失败：" + String(r.stderr || "").slice(0, 200) };
}

/* ---------------- 工具定义 ---------------- */
const TOOLS = [
  {
    name: "profile_get",
    description: "读取当前简历资料（姓名、经历、技能、投递记录）。开始任何操作前先调这个。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "profile_set",
    description: "写入或更新简历字段。只传要改的部分即可，会自动深合并。例如 {\"profile\":{\"name\":\"张三\"}}",
    inputSchema: {
      type: "object",
      properties: { patch: { type: "object", description: "要合并进去的部分数据" } },
      required: ["patch"]
    }
  },
  {
    name: "resume_check",
    description: "六项机器可读体检 + 关键词覆盖。返回 pass/total、每一项的通过与否、缺失关键词。",
    inputSchema: {
      type: "object",
      properties: { jd: { type: "string", description: "可选。传了就先写入 target.jd 再算关键词覆盖" } }
    }
  },
  {
    name: "resume_export",
    description: "导出简历。format: html | pdf | md | json。文件写到 out/ 目录，返回路径。",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["html", "pdf", "md", "json"], default: "pdf" } },
      required: ["format"]
    }
  },
  {
    name: "track_add",
    description: "记一次投递，附带当前体检结果。",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" }, role: { type: "string" },
        skin: { type: "string", description: "用了哪套版式，如 serif/mono/sans/cn" }
      },
      required: ["company"]
    }
  },
  {
    name: "track_stats",
    description: "投递统计：总数、六项全过的份数、有回音的份数、各版式回复率。样本小于 8 时明确提示不要下结论。",
    inputSchema: { type: "object", properties: {} }
  }
];

/* ---------------- 调用 ---------------- */
function call(name, args = {}) {
  const S = read();
  switch (name) {
    case "profile_get":
      return { data: S };

    case "profile_set": {
      if (!args.patch || typeof args.patch !== "object") throw new Error("patch 必须是一个对象");
      write(merge(S, args.patch));
      return { data: { ok: true, checks: checks(read()) } };
    }

    case "resume_check": {
      if (args.jd) { S.target = S.target || {}; S.target.jd = args.jd; write(S); }
      const c = checks(S), k = kwStats(S);
      return { data: { pass: c.pass, total: c.total, layout: c.layout, content: c.content,
                       keywords: { rate: k.rate, hit: k.hit.length, miss: k.miss, total: k.total } } };
    }

    case "resume_export": {
      const fmt = args.format || "pdf";
      ensure();
      const base = (S.profile?.name || "resume").replace(/[\\/:*?"<>|]/g, "_");
      if (fmt === "json") {
        const f = path.join(OUT, base + ".json");
        fs.writeFileSync(f, JSON.stringify(S, null, 2), "utf8");
        return { data: { path: f } };
      }
      if (fmt === "md") {
        const f = path.join(OUT, base + ".md");
        fs.writeFileSync(f, toMarkdown(S), "utf8");
        return { data: { path: f } };
      }
      const hp = path.join(OUT, base + ".html");
      fs.writeFileSync(hp, renderHTML(S), "utf8");
      if (fmt === "html") return { data: { path: hp } };
      const pp = path.join(OUT, base + ".pdf");
      const r = tryPDF(hp, pp);
      return { data: r.ok ? { path: pp } : { path: hp, warning: r.reason } };
    }

    case "track_add": {
      const c = checks(S), k = kwStats(S);
      S.apps = S.apps || [];
      S.apps.unshift({
        company: args.company || "", role: args.role || S.target?.title || S.profile?.role || "",
        date: new Date().toISOString().slice(0, 10), skin: args.skin || "serif",
        chk: c.pass, kw: k.empty ? null : k.rate, status: "无回复"
      });
      write(S);
      return { data: { ok: true, total: S.apps.length } };
    }

    case "track_stats": {
      const apps = S.apps || [];
      const by = {};
      for (const a of apps) {
        by[a.skin] = by[a.skin] || { n: 0, re: 0 };
        by[a.skin].n++;
        if (a.status !== "无回复") by[a.skin].re++;
      }
      const full = apps.filter(a => a.chk === 6).length;
      const responded = apps.filter(a => a.status !== "无回复").length;
      return { data: { total: apps.length, fullPass: full, responded,
                       bySkin: by, reliable: apps.length >= 8,
                       note: apps.length >= 8 ? "" : "样本不足 8，任何回复率都还是噪音，不要据此下结论" } };
    }

    default:
      throw new Error("未知工具：" + name);
  }
}

function toMarkdown(S) {
  const p = S.profile || {}, L = ["# " + (p.name || "")];
  if (p.role) L.push("**" + p.role + "**" + (p.years ? " · " + p.years : ""));
  L.push([p.phone, p.email, p.city].filter(Boolean).join(" · "), "");
  if (p.summary) L.push(p.summary, "");
  const bu = a => lines(a).map(x => "- " + x).join("\n");
  if ((S.education || []).length) { L.push("## 教育背景"); for (const e of S.education) L.push("### " + [e.school, e.degree, e.major].filter(Boolean).join(" · "), (e.start || "") + " – " + (e.end || ""), e.note ? "- " + e.note : "", ""); }
  if ((S.experience || []).length) { L.push("## 工作经历"); for (const e of S.experience) L.push("### " + e.org + " · " + (e.role || ""), (e.start || "") + " – " + (e.end || ""), bu(e.bullets), ""); }
  if ((S.projects || []).length) { L.push("## 项目经历"); for (const e of S.projects) L.push("### " + e.name + " · " + (e.role || ""), bu(e.bullets), ""); }
  if ((S.skills || []).length) { L.push("## 技能"); for (const s of S.skills) { const it = Array.isArray(s.items) ? s.items.join(" · ") : s.items; L.push("- **" + (s.group || "技能") + "**：" + it); } }
  return L.join("\n");
}

/* ---------------- JSON-RPC over stdio ---------------- */
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "cv-studio", version: "1.0.0" }
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    const { name, arguments: a } = params || {};
    try {
      const r = call(name, a || {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: "错误：" + e.message }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, "未实现的方法：" + method);
}

process.stderr.write("cv(studio) MCP 已启动 · 数据在 " + PROFILE + "\n");
