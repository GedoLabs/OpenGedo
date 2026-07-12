'use client';

import { fontVars } from '@/app/components/gedo/typography';
// 目标详情共享弹窗 —— 从目标列表行 + 今日侧栏卡复用。
// 覆盖:O 编辑(复用 GoalEditModal)、KR 增删改、待办改名/删除、WOOP 折叠、
// 重新拆解(填意图 → 预览 → 可编辑 → 应用替换)、删除目标(带影响汇总)。
// 与 GoalEditModal/GoalWizard 一致 —— 文案走 app.planner.detail。
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Plus, Trash2, Sparkles, Loader2, Pencil } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { primaryBtnStyle, ghostBtnStyle, chipBtnStyle } from '@/app/components/gedo/primitives';
import GoalEditModal from './GoalEditModal';
import type { Goal } from './types';

type RawGoal = {
  id: string; title: string; description?: string; level?: string; parent_id?: string | null;
  status?: string; progress?: number; wish?: string; outcome?: string; obstacle?: string;
  life_wheel_dimension?: string; start_date?: string | null; end_date?: string | null;
};
type RawTask = { id: string; title: string; status?: string; goal_id?: string | null; key_result_id?: string | null };

const field: CSSProperties = {
  width: '100%', borderRadius: 8, background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)',
  padding: '8px 10px', fontSize: fontVars.sm, color: 'var(--g-text)', outline: 'none', fontFamily: 'var(--g-font-sans)',
};
const iconBtn: CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-muted)', display: 'flex', padding: 2 };

function SecTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', letterSpacing: '0.06em', marginBottom: 8 }}>{children}</div>;
}

function TodoRow({ t, onRename, onDel }: { t: RawTask; onRename: (id: string, title: string) => void; onDel: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const done = t.status === 'done' || t.status === 'skipped';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: done ? 'var(--g-accent)' : 'var(--g-border)' }} />
      {editing ? (
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus style={field}
          onBlur={() => { setEditing(false); if (title.trim() && title.trim() !== t.title) onRename(t.id, title.trim()); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ) : (
        <span style={{ flex: 1, fontSize: fontVars.sm, cursor: 'text', color: done ? 'var(--g-text-faint)' : 'var(--g-text-mid)', textDecoration: done ? 'line-through' : 'none' }} onClick={() => setEditing(true)}>{t.title}</span>
      )}
      <button style={iconBtn} onClick={() => onDel(t.id)}><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}

function KrRow({ kr, todos, onRename, onDelete, onRenameTodo, onDelTodo, noTodosLabel }: {
  kr: RawGoal; todos: RawTask[];
  onRename: (id: string, title: string) => void; onDelete: (id: string) => void;
  onRenameTodo: (id: string, title: string) => void; onDelTodo: (id: string) => void;
  noTodosLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(kr.title);
  return (
    <div style={{ border: '1px solid var(--g-border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <button style={iconBtn} onClick={() => setOpen(o => !o)}>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
        <span style={{ flexShrink: 0, padding: '1px 5px', fontSize: fontVars.sm, fontWeight: 700, borderRadius: 5, background: 'color-mix(in oklch, var(--g-dim-goal) 18%, transparent)', color: 'var(--g-dim-goal)' }}>KR</span>
        {editing ? (
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus style={field}
            onBlur={() => { setEditing(false); if (title.trim() && title.trim() !== kr.title) onRename(kr.id, title.trim()); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text)', cursor: 'text' }} onClick={() => setEditing(true)}>{kr.title}</span>
        )}
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', fontFamily: 'var(--g-font-mono)' }}>{kr.progress || 0}%</span>
        <button style={iconBtn} onClick={() => onDelete(kr.id)}><Trash2 className="w-3 h-3" /></button>
      </div>
      {open && (
        <div style={{ padding: '0 12px 10px 34px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {todos.length === 0 ? <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{noTodosLabel}</span>
            : todos.map(t => <TodoRow key={t.id} t={t} onRename={onRenameTodo} onDel={onDelTodo} />)}
        </div>
      )}
    </div>
  );
}

export default function GoalDetailModal({ goalId, open, onClose, onChanged }: {
  goalId: string | null; open: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app.planner.detail');
  const [goal, setGoal] = useState<RawGoal | null>(null);
  const [krs, setKrs] = useState<RawGoal[]>([]);
  const [todos, setTodos] = useState<RawTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [editO, setEditO] = useState(false);
  const [showWoop, setShowWoop] = useState(false);
  const [newKr, setNewKr] = useState('');
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState('');
  const [preview, setPreview] = useState<{ keyResults?: { id?: string; title: string }[] } | null>(null);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    try {
      const [gr, tr] = await Promise.all([api.listGoals(), api.listTasks()]);
      const items = ((gr?.items as RawGoal[]) ?? []);
      setGoal(items.find(x => x.id === goalId) ?? null);
      setKrs(items.filter(x => x.parent_id === goalId && x.level === 'key_result'));
      setTodos(((tr?.items as RawTask[]) ?? []).filter(t => t.goal_id === goalId));
    } finally { setLoading(false); }
  }, [api, goalId]);

  useEffect(() => { if (open && goalId) { setPreview(null); setIntent(''); setShowWoop(false); load(); } }, [open, goalId, load]);

  const reload = async () => { await load(); onChanged?.(); };

  const addKr = async () => { if (!newKr.trim() || !goalId) return; setBusy(true); try { await api.createGoal({ title: newKr.trim(), parent_id: goalId, level: 'key_result' }); setNewKr(''); await reload(); } finally { setBusy(false); } };
  const renameKr = async (id: string, title: string) => { await api.updateGoal(id, { title }); await reload(); };
  const delKr = async (id: string) => { if (!confirm(t('deleteKrConfirm'))) return; await api.deleteGoal(id); await reload(); };
  const renameTodo = async (id: string, title: string) => { await api.updateTask(id, { title }); await reload(); };
  const delTodo = async (id: string) => { await api.deleteTask(id); await reload(); };

  const delGoal = async () => {
    if (!goal) return;
    const done = todos.filter(t => t.status === 'done' || t.status === 'skipped').length;
    const prog = todos.filter(t => t.status === 'in_progress').length;
    const todo = todos.filter(t => t.status === 'todo').length;
    if (!confirm(t('deleteGoalConfirm', { title: goal.title, done, prog, todo }))) return;
    setBusy(true);
    try { await api.deleteGoal(goal.id); onChanged?.(); onClose(); } finally { setBusy(false); }
  };

  const genPreview = async () => {
    if (!goal) return;
    setPlanning(true);
    try {
      const r = await api.woopGenerate({ prompt: goal.title, woop: { wish: goal.wish, outcome: goal.outcome, obstacle: goal.obstacle }, regenerate_hint: intent.trim() || undefined });
      setPreview(r?.okrStructure ?? null);
    } finally { setPlanning(false); }
  };
  const applyPreview = async () => {
    if (!goal || !preview) return;
    setBusy(true);
    try { await api.decomposeGoal(goal.id, { okrStructure: preview, replace: true }); setPreview(null); setIntent(''); await reload(); } finally { setBusy(false); }
  };

  if (!open) return null;
  const hasWoop = !!(goal?.wish || goal?.outcome || goal?.obstacle);

  return (
    <Modal open={open} onClose={onClose} eyebrow={t('eyebrow')} title={goal?.title || t('loading')} size="lg"
      footer={<button type="button" style={ghostBtnStyle()} onClick={onClose}>{t('close')}</button>}>
      {loading || !goal ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--g-text-muted)' }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('summary', { progress: goal.progress || 0, todos: todos.length, krs: krs.length })}</span>
              <div style={{ flex: 1 }} />
              {hasWoop && <button type="button" style={chipBtnStyle(showWoop)} onClick={() => setShowWoop(s => !s)}>WOOP</button>}
              <button type="button" style={chipBtnStyle()} onClick={() => setEditO(true)}><Pencil className="w-3 h-3" /> {t('editGoal')}</button>
            </div>
            {goal.description && <p style={{ margin: '8px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{goal.description}</p>}
            {showWoop && hasWoop && (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: fontVars.sm }}>
                {goal.wish && <div><b style={{ color: 'var(--g-accent)' }}>{t('woopWish')}</b>　{goal.wish}</div>}
                {goal.outcome && <div><b style={{ color: 'var(--g-warning, #f59e0b)' }}>{t('woopOutcome')}</b>　{goal.outcome}</div>}
                {goal.obstacle && <div><b style={{ color: 'var(--g-danger)' }}>{t('woopObstacle')}</b>　{goal.obstacle}</div>}
              </div>
            )}
          </section>

          <section>
            <SecTitle>{t('krSection')}</SecTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {krs.length === 0 && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('noKr')}</span>}
              {krs.map(kr => <KrRow key={kr.id} kr={kr} todos={todos.filter(tk => tk.key_result_id === kr.id)} onRename={renameKr} onDelete={delKr} onRenameTodo={renameTodo} onDelTodo={delTodo} noTodosLabel={t('noTodos')} />)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={newKr} onChange={e => setNewKr(e.target.value)} placeholder={t('addKrPlaceholder')} style={field} onKeyDown={e => { if (e.key === 'Enter') addKr(); }} />
              <button type="button" style={{ ...primaryBtnStyle(true), opacity: newKr.trim() && !busy ? 1 : 0.5, whiteSpace: 'nowrap' }} disabled={!newKr.trim() || busy} onClick={addKr}><Plus className="w-3 h-3" /> {t('addKr')}</button>
            </div>
          </section>

          {todos.filter(t => !t.key_result_id).length > 0 && (
            <section>
              <SecTitle>{t('orphanTodos')}</SecTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {todos.filter(t => !t.key_result_id).map(t => <TodoRow key={t.id} t={t} onRename={renameTodo} onDel={delTodo} />)}
              </div>
            </section>
          )}

          <section style={{ borderTop: '1px solid var(--g-border)', paddingTop: 14 }}>
            <SecTitle>{t('replanSection')}</SecTitle>
            {!preview ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea value={intent} onChange={e => setIntent(e.target.value)} rows={2} placeholder={t('replanPlaceholder')} style={{ ...field, resize: 'vertical' }} />
                <button type="button" style={ghostBtnStyle()} disabled={planning} onClick={genPreview}>
                  {planning ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('genPreviewing')}</> : <><Sparkles className="w-3 h-3" /> {t('genPreview')}</>}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('previewHint')}</div>
                {(preview.keyResults ?? []).map((k, i) => (
                  <input key={k.id || i} value={k.title} style={field}
                    onChange={e => setPreview(p => p ? { ...p, keyResults: (p.keyResults ?? []).map((x, j) => j === i ? { ...x, title: e.target.value } : x) } : p)} />
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={ghostBtnStyle()} onClick={() => setPreview(null)} disabled={busy}>{t('discard')}</button>
                  <button type="button" style={chipBtnStyle()} onClick={genPreview} disabled={planning}>{t('regen')}</button>
                  <div style={{ flex: 1 }} />
                  <button type="button" style={primaryBtnStyle()} onClick={applyPreview} disabled={busy}>{busy ? t('applying') : t('applyReplace')}</button>
                </div>
              </div>
            )}
          </section>

          <section style={{ borderTop: '1px solid var(--g-border)', paddingTop: 14 }}>
            <button type="button" disabled={busy} onClick={delGoal}
              style={{ ...ghostBtnStyle(), color: 'var(--g-danger)', borderColor: 'color-mix(in oklch, var(--g-danger) 30%, transparent)' }}>
              <Trash2 className="w-3 h-3" /> {t('deleteGoal')}
            </button>
          </section>
        </div>
      )}

      {editO && goal && (
        <GoalEditModal
          goal={{ id: goal.id, title: goal.title, description: goal.description, lifeWheelDimension: (goal.life_wheel_dimension || 'growth'), status: (goal.status || 'active'), progress: goal.progress || 0, level: 'objective', wish: goal.wish, outcome: goal.outcome, obstacle: goal.obstacle, createdAt: '', updatedAt: '' } as Goal}
          saving={false}
          onCancel={() => setEditO(false)}
          onSave={async patch => {
            await api.updateGoal(goal.id, { title: patch.title, description: patch.description, life_wheel_dimension: patch.lifeWheelDimension, wish: patch.wish, outcome: patch.outcome, obstacle: patch.obstacle });
            setEditO(false);
            await reload();
          }}
        />
      )}
    </Modal>
  );
}
