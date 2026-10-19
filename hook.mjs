// Хук для Claude Code и Codex: читает событие из stdin и отправляет короткую сводку на сервер офиса.
// Аргумент: claude или codex (кто запустил хук).
// Текст твоих запросов и команд НЕ отправляется: только id сессии, папка, событие и имя инструмента.
// Всегда выходит с кодом 0, чтобы никогда не мешать работе Claude, даже если сервер выключен.
const URL = `http://127.0.0.1:${process.env.OFFICE_PORT || 7777}/event`;
setTimeout(() => process.exit(0), 2000);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const ev = JSON.parse(raw);
    const body = {
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
