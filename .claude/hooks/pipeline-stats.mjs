// Статистика конвейера: какая модель работала у каждого агента, сколько токенов и времени ушло.
//   node .claude/hooks/pipeline-stats.mjs start   — начать новый прогон (очищает журнал)
//   node .claude/hooks/pipeline-stats.mjs report  — таблица по прогону
//   без аргумента — режим хука SubagentStop: событие приходит в stdin, строка дописывается в журнал
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LOG = path.join(root, '.claude', 'pipeline-stats.jsonl');
const mode = process.argv[2];

if (mode === 'start') {
  fs.writeFileSync(LOG, '');
  console.log('Статистика конвейера: новый прогон');
} else if (mode === 'report') {
  report();
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try { record(JSON.parse(input)); } catch {}   // хук никогда не должен мешать работе
}

function record(ev) {
  const file = transcriptOf(ev);
  const at = new Date().toISOString();
  if (!file) {
    const agent = ev.agent_type || ev.subagent_type || ev.agent_id || '?';
    fs.appendFileSync(LOG, JSON.stringify({ at, agent, ms: 0, models: {}, noTranscript: true }) + '\n');
    return;
  }
  const seen = new Set(), models = {};
  let first = null, last = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.timestamp) { const t = Date.parse(d.timestamp); first ??= t; last = t; }
    const m = d.message;
    if (d.type !== 'assistant' || !m?.usage) continue;
    const key = m.id || d.requestId || d.uuid;   // один ответ модели пишется несколькими строками
    if (seen.has(key)) continue;
    seen.add(key);
    const u = m.usage, s = (models[m.model || '?'] ??= { input: 0, cached: 0, output: 0, calls: 0 });
    s.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    s.cached += u.cache_read_input_tokens || 0;
    s.output += u.output_tokens || 0;
    s.calls++;
  }
  const agent = ev.agent_type || ev.subagent_type || path.basename(file, '.jsonl');
  const ms = first && last ? last - first : 0;
  fs.appendFileSync(LOG, JSON.stringify({ at, agent, ms, models }) + '\n');
}

// Где лежит переписка агента: новое поле хука или agent-<id>.jsonl в папке subagents рядом с перепиской сессии.
function transcriptOf(ev) {
  if (ev.agent_transcript_path && fs.existsSync(ev.agent_transcript_path)) return ev.agent_transcript_path;
  if (!ev.transcript_path || !ev.agent_id) return null;
  const f = path.join(ev.transcript_path.replace(/\.jsonl$/, ''), 'subagents', `agent-${ev.agent_id}.jsonl`);
  return fs.existsSync(f) ? f : null;
}

function report() {
  let rows = [];
  try { rows = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
  if (!rows.length) { console.log('Статистики нет: журнал пуст (хук SubagentStop ничего не записал или прогон не начат командой start)'); return; }
  const k = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const sec = ms => ms >= 60000 ? `${Math.floor(ms / 60000)}м ${Math.round(ms % 60000 / 1000)}с` : `${Math.round(ms / 1000)}с`;
  const out = ['| # | Агент | Модель | Вызовов | Вход | Из кэша | Выход | Время |', '|---|---|---|---|---|---|---|---|'];
  const total = {};
  let totalMs = 0;
  rows.forEach((r, i) => {
    totalMs += r.ms;
    if (!Object.keys(r.models).length) {
      out.push(`| ${i + 1} | ${r.agent} | ${r.noTranscript ? 'нет переписки' : '—'} | 0 | 0 | 0 | 0 | ${sec(r.ms)} |`);
      return;
    }
    for (const [model, s] of Object.entries(r.models)) {
      out.push(`| ${i + 1} | ${r.agent} | ${model} | ${s.calls} | ${k(s.input)} | ${k(s.cached)} | ${k(s.output)} | ${sec(r.ms)} |`);
      const t = (total[model] ??= { input: 0, cached: 0, output: 0, calls: 0 });
      for (const f in t) t[f] += s[f];
    }
  });
  out.push('', '**Итого по моделям**', '', '| Модель | Вызовов | Вход | Из кэша | Выход |', '|---|---|---|---|---|');
  for (const [model, s] of Object.entries(total)) out.push(`| ${model} | ${s.calls} | ${k(s.input)} | ${k(s.cached)} | ${k(s.output)} |`);
  out.push('', `Время агентов всего: ${sec(totalMs)}. Токены самого дирижёра (главной сессии) сюда не входят, их показывает /cost.`);
  console.log(out.join('\n'));
}
