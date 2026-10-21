// Локальный сервер AI-офиса.
// 1) Каждые 4 секунды смотрит, какие AI-программы открыты: Claude Code, приложение Claude, Codex, ChatGPT.
//    Пока процесс открыт, его агент сидит в офисе. Закрыл окно: агент уходит.
// 2) Хуки Claude Code и Codex присылают события (POST /event): работает, ждёт тебя, закончил.
//    У ChatGPT и приложения Claude хуков нет: «работает» определяется по нагрузке на процессор.
// Обои читают GET /state. Слушает только 127.0.0.1, снаружи не виден.
// 3) Сам не висит без дела:
//    OFFICE_WITH_WE=1 (Windows, запуск из watch.vbs): выходит, когда Wallpaper Engine закрыт и обои давно не спрашивали;
//    OFFICE_WITH_PARENT=1 (приложение на Mac): выходит, как только закрылось приложение (закрылся stdin).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.OFFICE_PORT || 7777);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCAN_MS = 4000;
const CPU_BUSY = 0.05;              // доля одного ядра, выше которой считаем, что программа «думает»

const WITH_WE = process.env.OFFICE_WITH_WE === '1';
const IDLE_MS = 30e3;               // обои не спрашивали 30 с: сканируем редко
const LABEL = { claude: 'Claude Code', 'claude-app': 'Claude', codex: 'Codex', chatgpt: 'ChatGPT' };

// ---------- процессы ----------
let procTable = new Map();           // pid -> { pid, ppid, name, kind? }
const procAgents = new Map();        // pid корня -> { pid, kind, firstSeen, cpuPrev, busyUntil, cpuBusy }
let lastScanOk = false;

function kindOf(p, table) {
  const n = (p.name || '').toLowerCase(), exe = (p.exe || '').toLowerCase(), cmd = (p.cmd || '').toLowerCase();
  if (n === 'chatgpt.exe') return 'chatgpt';
  if (/^codex.*\.exe$/.test(n)) return 'codex';
  if (n === 'claude.exe') {
    const desktopPath = exe.includes('anthropicclaude') || exe.includes('\\windowsapps\\') || /\\claude\\app-/.test(exe);
    if (!desktopPath) return 'claude';
    const parent = table.get(p.ppid);
    const parentIsApp = parent && (parent.name || '').toLowerCase() === 'claude.exe';
    if (parentIsApp && !cmd.includes('--type=')) return 'claude';   // сессия Claude Code внутри приложения
    return 'claude-app';
  }
  // macOS / Linux: имена без .exe, программы лежат в *.app
  if (!n.endsWith('.exe')) {
    if (exe.includes('/chatgpt.app/')) return 'chatgpt';
    if (n === 'claude') return 'claude';
    if (/^codex/.test(n) || exe.includes('/codex.app/')) return 'codex';
    if (exe.includes('/claude.app/')) return 'claude-app';
  }
  if (n === 'node.exe' || n === 'node') {
    if (/claude-code|@anthropic-ai[\\/]claude/.test(cmd)) return 'claude';
    if (/@openai[\\/]codex/.test(cmd)) return 'codex';
  }
  return null;
}

function scanWindows() {
  const ps = `$i='^(claude|codex.*|chatgpt|node)\\.exe$'
Get-CimInstance Win32_Process | ForEach-Object {
 if ($_.Name -match $i) { [pscustomobject]@{i=$_.ProcessId;p=$_.ParentProcessId;n=$_.Name;e=$_.ExecutablePath;c=$_.CommandLine;t=$_.KernelModeTime+$_.UserModeTime} }
 else { [pscustomobject]@{i=$_.ProcessId;p=$_.ParentProcessId;n=$_.Name} } } | ConvertTo-Json -Compress`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10000, maxBuffer: 32e6 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out).map(x => ({ pid: x.i, ppid: x.p, name: x.n, exe: x.e, cmd: x.c, cpu: (x.t || 0) / 1e7 }))); }
      catch { resolve(null); }
    });
  });
}

// macOS и Linux: два вызова ps (путь к программе может содержать пробелы, поэтому отдельно от аргументов).
const run = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 10000, maxBuffer: 32e6 }, (e, out) => r(e ? null : out)));
const secs = t => String(t).split(/[-:]/).map(Number).reverse().reduce((s, v, i) => s + v * [1, 60, 3600, 86400][i], 0);
async function scanPosix() {
  const [a, b] = await Promise.all([run('ps', ['-axww', '-o', 'pid=,ppid=,time=,comm=']), run('ps', ['-axww', '-o', 'pid=,args='])]);
  if (!a || !b) return null;
  const args = new Map();
  for (const l of b.split('\n')) { const m = l.match(/^\s*(\d+)\s+(.*)$/); if (m) args.set(+m[1], m[2]); }
  const list = [];
  for (const l of a.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const exe = m[4].trim();
    list.push({ pid: +m[1], ppid: +m[2], name: exe.split('/').pop(), exe, cmd: args.get(+m[1]) || '', cpu: secs(m[3]) });
  }
  return list;
}

// Для проверки на другой ОС: OFFICE_PROCS_FILE=файл.json со списком {pid, ppid, name, exe, cmd, cpu}.
async function scanProcs() {
  if (process.env.OFFICE_PROCS_FILE) {
    try { return JSON.parse(fs.readFileSync(process.env.OFFICE_PROCS_FILE, 'utf8')); } catch { return null; }
  }
  if (process.platform === 'win32') return scanWindows();
  return scanPosix();
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const list = await scanProcs();
    lastScanOk = !!list;
    if (!list) return;
    if (WITH_WE) {
      const we = list.some(p => /^wallpaper(32|64)\.exe$/i.test(p.name || ''));
      if (!we && Date.now() - lastPoll > 60e3) { console.log('Wallpaper Engine закрыт: выключаюсь.'); process.exit(0); }
    }
    const table = new Map(list.map(p => [p.pid, p]));
    for (const p of list) p.kind = kindOf(p, table);
    procTable = table;
    // корень группы: процесс нужного вида, у которого родитель другого вида (вкладки Electron и дочерние процессы схлопываются)
    const roots = new Map();
    for (const p of list) {
      if (!p.kind) continue;
      let root = p;
      for (let up = table.get(p.ppid), guard = 0; up && up.kind === p.kind && guard < 20; up = table.get(up.ppid), guard++) root = up;
      // Codex запускает много отдельных процессов: все они один агент (ключ -1).
      const key = root.kind === 'codex' ? -1 : root.pid;
      const r = roots.get(key) || { pid: key, kind: root.kind, cpu: 0 };
      r.cpu += p.cpu || 0;
      roots.set(key, r);
    }
    const now = Date.now();
    for (const [pid, r] of roots) {
      let a = procAgents.get(pid);
      if (!a) { a = { pid, kind: r.kind, firstSeen: now, cpuPrev: r.cpu, cpuBusy: false, busyUntil: 0 }; procAgents.set(pid, a); continue; }
      const load = (r.cpu - a.cpuPrev) / (SCAN_MS / 1000);
      a.cpuPrev = r.cpu;
      if (load > CPU_BUSY) a.busyUntil = now + 20e3;     // после всплеска считаем занятым ещё 20 секунд
      a.cpuBusy = now < a.busyUntil;
    }
    for (const pid of [...procAgents.keys()]) if (!roots.has(pid)) procAgents.delete(pid);
  } finally { scanning = false; }
}
// Пока обои спрашивают /state, сканируем каждые 4 с. Обои на паузе или закрыты: раз в 30 с, почти без нагрузки.
let lastPoll = Date.now(), lastScan = 0;
setInterval(() => {
  const now = Date.now();
  if (now - lastPoll < IDLE_MS || now - lastScan >= IDLE_MS) { lastScan = now; scan(); }
}, SCAN_MS);
scan();
if (process.env.OFFICE_WITH_PARENT === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

// ---------- автообновление ----------
// Установленный офис (OFFICE_VERSION_FILE задаёт установщик) раз в 12 часов сверяет свою версию с GitHub.
// Если вышла новая, тихо запускает тот же установщик: он обновит файлы и перезапустит сервер.
const REPO = 'AlexanderGrandees/thegrandees-ai-office';
const VERSION_FILE = process.env.OFFICE_VERSION_FILE;
async function latestVersion() {
  const headers = { 'user-agent': 'tgti-ai-office', accept: 'application/vnd.github+json' };
  if (process.platform === 'darwin') {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/mac-latest`, { headers });
    return r.ok ? (await r.json()).assets?.find(a => a.name.endsWith('.zip'))?.updated_at : null;
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers });
  return r.ok ? (await r.json()).sha : null;
}
async function checkUpdate() {
  try {
    const mine = fs.readFileSync(VERSION_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!mine || mine === 'local') return;                     // ручная или тестовая установка: не трогаем
    const latest = await latestVersion();
    if (!latest || latest === mine) return;
    console.log(`Новая версия ${latest}: обновляюсь.`);
    const [cmd, args] = process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', `$env:TGTI_UPDATE='1'; irm https://raw.githubusercontent.com/${REPO}/main/windows/install.ps1 | iex`]]
      : ['/bin/bash', ['-c', `TGTI_UPDATE=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/macos/install.sh)"`]];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* нет сети или файла версии: попробуем позже */ }
}
if (VERSION_FILE) { setTimeout(checkUpdate, 60e3); setInterval(checkUpdate, 12 * 3600e3); }

// ---------- сессии из хуков ----------
const sessions = new Map();

function folderOf(cwd) { return String(cwd || '').split(/[\\/]/).filter(Boolean).pop()?.slice(0, 24) || ''; }

function apply(ev) {
  const id = String(ev.session_id || '').slice(0, 80);
  if (!id) return;
  const now = Date.now();
  let s = sessions.get(id);
  if (!s) { s = { id, kind: ev.agent === 'codex' ? 'codex' : 'claude', folder: '', status: 'idle', tool: '', detail: '', last: now, ppid: 0, pid: 0 }; sessions.set(id, s); }
  if (ev.cwd) s.folder = folderOf(ev.cwd);
  if (ev.ppid) s.ppid = Number(ev.ppid);
  s.last = now;
  const msg = String(ev.message || '');
  const detail = String(ev.detail || '').slice(0, 24);
  switch (ev.hook_event_name) {
    case 'SessionStart': s.status = 'idle'; s.tool = ''; s.detail = ''; break;
    case 'UserPromptSubmit': s.status = 'working'; s.tool = 'думает'; s.detail = detail; break;
    case 'PreToolUse': s.status = 'working'; s.tool = String(ev.tool_name || '').slice(0, 40); s.detail = detail; break;
    case 'PostToolUse': s.status = 'working'; break;
    case 'PermissionRequest': s.status = 'waiting'; s.tool = String(ev.tool_name || '').slice(0, 40); s.detail = detail; break;
    case 'Notification':
      if (ev.notification_type === 'idle_prompt' || /waiting for your input/i.test(msg)) { s.status = 'idle'; s.tool = ''; }
      else { s.status = 'waiting'; s.tool = msg.slice(0, 80); }
      break;
    case 'Stop': s.status = 'idle'; s.tool = ''; s.detail = ''; break;
    case 'SessionEnd': s.status = 'gone'; break;
  }
  if (s.ppid && !procTable.has(s.ppid)) scan();
}

// К какому открытому процессу относится сессия: ищем вверх по родителям от процесса, запустившего хук.
function linkSession(s) {
  if (s.pid && procAgents.has(s.pid)) return s.pid;
  for (let pid = s.ppid, guard = 0; pid && guard < 30; guard++) {
    if (procAgents.has(pid)) return (s.pid = pid);
    const p = procTable.get(pid);
    if (!p) break;
    if (p.kind === 'codex' && procAgents.has(-1)) return (s.pid = -1);
    pid = p.ppid;
  }
  return 0;
}

// Уборка: закрытые сессии убираем через 15 с, совсем тихие через 30 мин, «работает» без событий 10 мин = отдых.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const quiet = now - s.last;
    if ((s.status === 'gone' && quiet > 15e3) || quiet > 30 * 60e3) sessions.delete(id);
    else if (s.status === 'working' && quiet > 10 * 60e3) { s.status = 'idle'; s.tool = ''; }
  }
}, 10e3);

function state() {
  const now = Date.now();
  const byPid = new Map();
  const live = [...sessions.values()].filter(s => s.status !== 'gone').sort((a, b) => b.last - a.last);
  const unlinked = [];
  for (const s of live) {
    const pid = linkSession(s);
    if (pid && !byPid.has(pid)) byPid.set(pid, s); else if (!pid) unlinked.push(s);
  }
  // Не нашли родителя (например, хук запущен через оболочку, которая уже закрылась): пара по виду программы.
  for (const s of unlinked) {
    const free = [...procAgents.values()].filter(a => a.kind === s.kind && !byPid.has(a.pid)).sort((a, b) => b.firstSeen - a.firstSeen)[0];
    if (free) { byPid.set(free.pid, s); s.pid = free.pid; }
  }
  const out = [];
  for (const a of [...procAgents.values()].sort((x, y) => x.firstSeen - y.firstSeen)) {
    const s = byPid.get(a.pid);
    const fresh = s && now - s.last < 10 * 60e3;
    out.push({
      id: `${a.kind}-${a.pid}`,
      kind: a.kind,
      name: LABEL[a.kind] + (s?.folder ? ` · ${s.folder}` : ''),
      status: fresh ? s.status : (a.cpuBusy ? 'working' : 'idle'),
      tool: fresh ? s.tool : '',
      detail: fresh && s.status !== 'idle' ? s.detail : '',
      hooks: !!s,
    });
  }
  // Сессия без найденного процесса (или сканирование недоступно): показываем, пока от неё были события за 2 минуты.
  const linked = new Set(byPid.values());
  for (const s of live) if (!linked.has(s) && (!lastScanOk || now - s.last < 120e3)) out.push({ id: s.id, kind: s.kind, name: LABEL[s.kind] + (s.folder ? ` · ${s.folder}` : ''), status: s.status, tool: s.tool, detail: s.status !== 'idle' ? s.detail : '', hooks: true });
  return out;
}

const nowMs = () => Date.now();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Private-Network': 'true',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64e3) req.destroy(); });
    req.on('end', () => {
      try { apply(JSON.parse(body)); } catch { /* битое событие просто пропускаем */ }
      res.writeHead(204, CORS); res.end();
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/state')) {
    if (nowMs() - lastPoll >= IDLE_MS) setTimeout(scan, 0);   // обои проснулись: сразу свежий список
    lastPoll = nowMs();
    res.writeHead(200, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ agents: state(), scan: lastScanOk, now: Date.now() }));
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(DIR, 'index.html')).pipe(res);
  }
  const font = req.method === 'GET' && req.url.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font && fs.existsSync(path.join(DIR, 'fonts', font[1]))) {
    res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
    return fs.createReadStream(path.join(DIR, 'fonts', font[1])).pipe(res);
  }
  res.writeHead(404, CORS); res.end();
}).on('error', e => {
  // уже запущен другой копией: тихо выходим, второй не нужен
  if (e.code === 'EADDRINUSE') { console.log(`Порт ${PORT} уже занят: сервер офиса уже работает.`); process.exit(0); }
  throw e;
}).listen(PORT, '127.0.0.1', () => {
  console.log(`AI-офис слушает http://127.0.0.1:${PORT}`);
});
