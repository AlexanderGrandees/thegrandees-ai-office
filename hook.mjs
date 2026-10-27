// Хук для Claude Code и Codex: читает событие из stdin и отправляет короткую сводку на сервер офиса.
// Аргумент: claude или codex (кто запустил хук).
// Полный текст запросов и команд НЕ отправляется. Кроме id сессии, папки, события и имени инструмента
// уходит только короткая подпись (detail): имя файла, первые слова команды, домен сайта
// или первые 6 символов запроса с «…». Всё остаётся на этом компьютере (127.0.0.1).
// Ещё уходит имя модели (например claude-opus-5-5): из события или из хвоста файла переписки сессии.
// Всегда выходит с кодом 0, чтобы никогда не мешать работе Claude, даже если сервер выключен.
import fs from 'node:fs';

const URL = `http://127.0.0.1:${process.env.OFFICE_PORT || 7777}/event`;
setTimeout(() => process.exit(0), 2000);

// короткая подпись того, что агент делает сейчас
const clip = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const base = f => String(f).split(/[\\/]/).filter(Boolean).pop() || '';
function detailOf(ev) {
  try {
    if (ev.hook_event_name === 'UserPromptSubmit') return clip(ev.prompt, 6) || undefined;
    if (ev.hook_event_name !== 'PreToolUse' && ev.hook_event_name !== 'PermissionRequest') return undefined;
    const ti = ev.tool_input || {};
    const f = ti.file_path || ti.notebook_path || ti.path;
    if (f) return clip(base(f), 22);
    if (ti.command) {
      const w = String(Array.isArray(ti.command) ? ti.command.join(' ') : ti.command).trim().split(/\s+/);
      const cmd = base(w[0]).replace(/\.(exe|cmd)$/i, '');
      return clip(/^(git|npm|npx|dotnet|pnpm|yarn|cargo|go|python3?|pip|node)$/.test(cmd) && w[1] ? `${cmd} ${w[1]}` : cmd, 18);
    }
    if (ti.url) { try { return new globalThis.URL(ti.url).hostname.replace(/^www\./, '').slice(0, 22); } catch { return undefined; } }
    if (ti.query || ti.pattern) return clip(ti.query || ti.pattern, 6);
    if (ti.description) return clip(ti.description, 10);
  } catch {}
  return undefined;
}

// какая модель сейчас отвечает: Claude Code кладёт её в SessionStart, а в остальных событиях
// берём последнюю из файла переписки (читаем только хвост, это быстро)
function modelOf(ev) {
  if (ev.model) return String(typeof ev.model === 'object' ? ev.model.id || ev.model.display_name || '' : ev.model).slice(0, 60) || undefined;
  if (!ev.transcript_path) return undefined;
  try {
    const fd = fs.openSync(ev.transcript_path, 'r');
    try {
      const size = fs.fstatSync(fd).size, n = Math.min(size, 256 * 1024), buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      const all = [...buf.toString('utf8').matchAll(/"model"\s*:\s*"((?:claude|gpt|o\d)[^"]{1,58})"/g)].map(m => m[1]);
      return all.at(-1);
    } finally { fs.closeSync(fd); }
  } catch { return undefined; }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const ev = JSON.parse(raw);
    const body = {
      detail: detailOf(ev),
      model: modelOf(ev),
      agent: process.argv[2] === 'codex' ? 'codex' : 'claude',
      ppid: process.ppid,
      session_id: ev.session_id,
      hook_event_name: ev.hook_event_name,
      cwd: ev.cwd,
      tool_name: ev.tool_name,
      notification_type: ev.notification_type,
      message: ev.hook_event_name === 'Notification' ? ev.message : undefined,
    };
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(800),
    });
  } catch { /* сервер не запущен: молча выходим */ }
  process.exit(0);
});
