// Проверка без Claude: изображает одного агента. Запуск: node test-agent.mjs ИМЯ
// Он приходит с улицы, работает, просит разрешение, снова работает, сидит без дела и уходит.
const name = process.argv[2] || 'TEST';
const id = `test-${name}-${Date.now()}`;
const steps = [
  [0, { hook_event_name: 'SessionStart' }],
  [4, { hook_event_name: 'UserPromptSubmit' }],
  [3, { hook_event_name: 'PreToolUse', tool_name: 'Bash' }],
  [6, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }],
  [6, { hook_event_name: 'PostToolUse', tool_name: 'Bash' }],
  [5, { hook_event_name: 'Stop' }],
  [50, { hook_event_name: 'SessionEnd' }],
];
for (const [wait, ev] of steps) {
  await new Promise(r => setTimeout(r, wait * 1000));
  const body = { agent: 'claude', session_id: id, cwd: `C:/test/${name}`, ...ev };
  try {
    await fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    console.log(name, ev.hook_event_name, ev.tool_name || '');
  } catch { console.log('Сервер не запущен: сначала start-office.cmd'); process.exit(1); }
}
