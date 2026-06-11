'use client';

import { useState, useEffect } from 'react';
import { HabitItem, ItemLog, DayLog, UserData } from '../lib/types';
import { getUserData, initUserData, getTodayDate, getTodayLog, saveDayLog, getStreak, upsertHabit, deleteHabit } from '../lib/store';
import { calculateDailyMetrics } from '../lib/scoring';

const EMOJI_PRESETS = ['💻', '🏋️', '📚', '🧘', '🏃', '🎮', '🍿', '🏀', '🎧', '😴', '🎨', '🚗'];

// "Take a break" nudge fires every time the bank crosses another full chunk
const BREAK_CHUNK_MINS = 30;

const TIMER_KEY = 'getdone_timer';

const DEFAULT_HABITS: HabitItem[] = [
  { id: '1', name: 'Deep Work', emoji: '💻', type: 'grind', valueType: 'duration', earnRate: 0.25 }, // 1 hr = 15m
  { id: '2', name: 'Workout', emoji: '🏋️', type: 'grind', valueType: 'duration', earnRate: 0.5 }, // 1 hr = 30m
  { id: '3', name: 'Cook Dinner', emoji: '🍳', type: 'grind', valueType: 'counter', earnRate: 20 }, // 1 time = 20m
  { id: '4', name: 'PS5 Guilt-Free', emoji: '🎮', type: 'glow', valueType: 'duration', costRate: 1.0 }, // 1m = 1m
  { id: '5', name: 'Doomscrolling', emoji: '📱', type: 'glow', valueType: 'duration', costRate: 1.5 }, // Tax on bad habits
];

export default function Home() {
  const [data, setData] = useState<UserData | null>(null);
  const [todayLog, setTodayLog] = useState<DayLog | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'grind' | 'glow' }[]>([]);
  const [modal, setModal] = useState<{ type: 'grind' | 'glow'; habit: HabitItem | null } | null>(null);
  const [form, setForm] = useState({ name: '', emoji: '', valueType: 'duration' as 'duration' | 'counter', rate: '' });
  const [timer, setTimer] = useState<{ habitId: string; type: 'grind' | 'glow'; startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let userData = getUserData();
    if (!userData) {
      userData = initUserData(DEFAULT_HABITS);
    }
    setData(userData);

    if (!userData.onboardingComplete) {
      window.location.href = '/onboarding';
      return;
    }

    const date = getTodayDate();
    let log = getTodayLog(userData);
    
    if (!log) {
      log = {
        date,
        grindLogs: [],
        glowLogs: [],
        earnedTimeDelta: 0,
        score: 0
      };
    }
    setTodayLog(log);
    setMounted(true);
  }, []);

  // Restore a running timer (it survives page refresh via localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (raw) setTimer(JSON.parse(raw));
    } catch { /* corrupt timer state — start fresh */ }
  }, []);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const showToast = (message: string, type: 'grind' | 'glow') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  if (!mounted || !data || !todayLog) return null;

  const grindHabits = data.habits.filter(h => h.type === 'grind');
  const glowHabits = data.habits.filter(h => h.type === 'glow');

  const startTimer = (habitId: string, type: 'grind' | 'glow') => {
    const t = { habitId, type, startedAt: Date.now() };
    setTimer(t);
    setNow(Date.now());
    localStorage.setItem(TIMER_KEY, JSON.stringify(t));
    // Ask for notification permission on first timer use — that's when the
    // "time to unwind" nudge becomes meaningful
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const stopTimer = () => {
    if (!timer) return;
    const mins = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
    setTimer(null);
    localStorage.removeItem(TIMER_KEY);
    addIncrement(timer.habitId, timer.type, mins);
  };

  const formatElapsed = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const addIncrement = (habitId: string, type: 'grind' | 'glow', amount: number) => {
    const habit = data.habits.find(h => h.id === habitId);
    if (!habit) return;
    const bankBefore = data.earnedTimeBank;

    const newLog = { ...todayLog };
    const logs = type === 'grind' ? newLog.grindLogs : newLog.glowLogs;
    
    let item = logs.find(l => l.habitId === habitId);
    if (!item) {
      item = { habitId, value: 0 };
      logs.push(item);
    }
    item.value += amount;
    
    const metrics = calculateDailyMetrics(newLog.grindLogs, newLog.glowLogs, data.habits);
    newLog.earnedTimeDelta = metrics.earnedTimeDelta;
    newLog.score = metrics.scoreInfo.score;

    // Show toast
    if (type === 'grind') {
      const earned = habit.valueType === 'duration' ? amount * (habit.earnRate || 0) : amount * (habit.earnRate || 0);
      showToast(`🔥 Awesome! +${earned} min earned`, 'grind');
    } else {
      const spent = habit.valueType === 'duration' ? amount * (habit.costRate || 0) : amount * (habit.costRate || 0);
      showToast(`🎮 Enjoy! -${spent} min spent`, 'glow');
    }

    setTodayLog(newLog);
    saveDayLog(newLog, data);

    const newData = getUserData();
    if (newData) setData(newData);

    // Apple-Watch-style nudge: every BREAK_CHUNK_MINS earned, remind to unwind
    if (type === 'grind' && newData) {
      const before = Math.floor(Math.max(0, bankBefore) / BREAK_CHUNK_MINS);
      const after = Math.floor(Math.max(0, newData.earnedTimeBank) / BREAK_CHUNK_MINS);
      if (after > before) {
        const earned = after * BREAK_CHUNK_MINS;
        const msg = `🛋 Time to unwind — you've banked ${earned} min. Go be yourself.`;
        showToast(msg, 'glow');
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('GetDone', { body: msg });
        }
      }
    }
  };

  const openModal = (type: 'grind' | 'glow', habit: HabitItem | null) => {
    if (habit) {
      // Rates are shown in friendly units (see saveHabit for the reverse mapping)
      const rate = habit.type === 'grind'
        ? (habit.valueType === 'duration' ? (habit.earnRate || 0) * 60 : habit.earnRate || 0)
        : (habit.valueType === 'duration' ? habit.costRate || 1 : habit.costRate || 0);
      setForm({ name: habit.name, emoji: habit.emoji, valueType: habit.valueType, rate: String(rate) });
    } else {
      setForm({ name: '', emoji: type === 'grind' ? '🔥' : '✨', valueType: 'duration', rate: type === 'grind' ? '15' : '1' });
    }
    setModal({ type, habit });
  };

  const saveHabit = () => {
    if (!modal || !form.name.trim()) return;
    const rateNum = parseFloat(form.rate) || 0;
    const habit: HabitItem = {
      id: modal.habit?.id || String(Date.now()),
      name: form.name.trim(),
      emoji: form.emoji.trim() || (modal.type === 'grind' ? '🔥' : '✨'),
      type: modal.type,
      valueType: form.valueType,
    };
    if (modal.type === 'grind') {
      habit.earnRate = form.valueType === 'duration' ? rateNum / 60 : rateNum;
    } else {
      habit.costRate = rateNum;
    }
    const newData = upsertHabit({ ...data }, habit);
    setData({ ...newData });
    recalcToday(newData);
    setModal(null);
  };

  const removeHabit = () => {
    if (!modal?.habit) return;
    const id = modal.habit.id;
    // Scrub today's entries for this habit so the bank stays consistent
    const newLog = {
      ...todayLog,
      grindLogs: todayLog.grindLogs.filter(l => l.habitId !== id),
      glowLogs: todayLog.glowLogs.filter(l => l.habitId !== id),
    };
    const newData = deleteHabit({ ...data }, id);
    const metrics = calculateDailyMetrics(newLog.grindLogs, newLog.glowLogs, newData.habits);
    newLog.earnedTimeDelta = metrics.earnedTimeDelta;
    newLog.score = metrics.scoreInfo.score;
    setTodayLog(newLog);
    saveDayLog(newLog, newData);
    setData({ ...newData });
    setModal(null);
  };

  const recalcToday = (userData: UserData) => {
    const metrics = calculateDailyMetrics(todayLog.grindLogs, todayLog.glowLogs, userData.habits);
    const newLog = { ...todayLog, earnedTimeDelta: metrics.earnedTimeDelta, score: metrics.scoreInfo.score };
    setTodayLog(newLog);
    saveDayLog(newLog, userData);
  };

  const streak = getStreak(data);
  const bankMins = Math.floor(data.earnedTimeBank);
  const isBankPositive = bankMins >= 0;
  
  // Bar represents two break-chunks (1 hour) so it visibly fills within a
  // single work session instead of taking a full day
  const maxBank = BREAK_CHUNK_MINS * 2;
  const progressPercent = Math.min(100, Math.max(0, (Math.abs(bankMins) / maxBank) * 100));

  return (
    <main className="container">
      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>

      <header className="header">
        <div>
          <h1 className="logo">GetDone.</h1>
          <p className="subtitle">Done for today. Go be yourself.</p>
        </div>
        <div className="streak">
          <span className="streak-icon">🔥</span>
          <span className="streak-count">{streak}</span>
        </div>
      </header>

      <section className="time-bank-widget">
        <div className="bank-info">
          <span className={`bank-value ${!isBankPositive ? 'negative' : ''}`}>
            {isBankPositive ? '+' : ''}{bankMins}
          </span>
          <span className="bank-label">Time Bank (Mins)</span>
        </div>
        
        <div className="bank-progress-container">
           <div 
             className={`bank-progress-bar ${!isBankPositive ? 'negative' : ''}`} 
             style={{ width: `${progressPercent}%` }}
           ></div>
        </div>

        <div className={`bank-status ${isBankPositive ? (bankMins > 0 ? 'status-positive' : 'status-neutral') : 'status-negative'}`}>
          {isBankPositive ? (bankMins > 0 ? 'You earned it ✨' : 'Time to grind') : 'In Debt ⚠️'}
        </div>
      </section>

      <section className="habits-container">
        {/* GRIND COLUMN */}
        <div className="habit-column">
          <h2 className="column-title">
            <span className="dot dot-grind"></span> Grind
          </h2>
          <div className="habit-list">
            {grindHabits.map(habit => {
              const log = todayLog.grindLogs.find(l => l.habitId === habit.id);
              const val = log?.value || 0;
              return (
                <div key={habit.id} className="habit-card grind">
                  <div className="habit-header">
                    <div className="habit-emoji">{habit.emoji}</div>
                    <div className="habit-info">
                      <div className="habit-name">{habit.name}</div>
                      <div className="habit-rate">
                        Earn <span className="rate-pill">{habit.valueType === 'duration' ? `${habit.earnRate! * 60}m` : `${habit.earnRate}m`}</span> {habit.valueType === 'duration' ? 'per hr' : 'per done'}
                      </div>
                    </div>
                    <button className="btn-edit" onClick={() => openModal('grind', habit)} aria-label="Edit habit">✎</button>
                  </div>
                  <div className="habit-controls">
                    {habit.valueType === 'duration' ? (
                      <>
                        {timer?.habitId === habit.id ? (
                          <button className="btn-timer-main timer-active grind" onClick={stopTimer}>
                            ■ {formatElapsed(now - timer.startedAt)}
                          </button>
                        ) : (
                          <button className="btn-timer-main grind" onClick={() => startTimer(habit.id, 'grind')} disabled={!!timer}>▶ Start</button>
                        )}
                        <button className="btn-increment btn-secondary-log" onClick={() => addIncrement(habit.id, 'grind', 15)}>+15m</button>
                        <button className="btn-increment btn-secondary-log" onClick={() => addIncrement(habit.id, 'grind', 60)}>+1h</button>
                      </>
                    ) : (
                      <button className="btn-increment" onClick={() => addIncrement(habit.id, 'grind', 1)}>+1 Done</button>
                    )}
                  </div>
                  {val > 0 && (
                    <div className="logged-value">
                      Logged today: {habit.valueType === 'duration' ? `${val}m` : `${val} times`}
                    </div>
                  )}
                </div>
              );
            })}
            <button className="btn-add-habit grind-add" onClick={() => openModal('grind', null)}>+ Add activity</button>
          </div>
        </div>

        {/* GLOW COLUMN */}
        <div className="habit-column">
          <h2 className="column-title">
            <span className="dot dot-glow"></span> Glow
          </h2>
          <div className="habit-list">
            {glowHabits.map(habit => {
              const log = todayLog.glowLogs.find(l => l.habitId === habit.id);
              const val = log?.value || 0;
              return (
                <div key={habit.id} className="habit-card glow">
                  <div className="habit-header">
                    <div className="habit-emoji">{habit.emoji}</div>
                    <div className="habit-info">
                      <div className="habit-name">{habit.name}</div>
                      <div className="habit-rate">
                        Cost <span className="rate-pill">{habit.costRate}x</span>
                      </div>
                    </div>
                    <button className="btn-edit" onClick={() => openModal('glow', habit)} aria-label="Edit habit">✎</button>
                  </div>
                  <div className="habit-controls">
                    {habit.valueType === 'duration' ? (
                      <>
                        {timer?.habitId === habit.id ? (
                          <button className="btn-timer-main timer-active glow" onClick={stopTimer}>
                            ■ {formatElapsed(now - timer.startedAt)}
                          </button>
                        ) : (
                          <button className="btn-timer-main glow" onClick={() => startTimer(habit.id, 'glow')} disabled={!!timer}>▶ Start</button>
                        )}
                        <button className="btn-increment btn-secondary-log" onClick={() => addIncrement(habit.id, 'glow', 15)}>-15m</button>
                        <button className="btn-increment btn-secondary-log" onClick={() => addIncrement(habit.id, 'glow', 60)}>-1h</button>
                      </>
                    ) : (
                      <button className="btn-increment" onClick={() => addIncrement(habit.id, 'glow', 1)}>-1 Done</button>
                    )}
                  </div>
                  {val > 0 && (
                    <div className="logged-value">
                      Spent today: {habit.valueType === 'duration' ? `${val}m` : `${val} times`}
                    </div>
                  )}
                </div>
              );
            })}
            <button className="btn-add-habit glow-add" onClick={() => openModal('glow', null)}>+ Add activity</button>
          </div>
        </div>
      </section>

      {/* Edit/Add Habit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {modal.habit ? 'Edit' : 'New'} {modal.type === 'grind' ? 'Grind' : 'Glow'} activity
            </h3>

            <div className="form-row">
              <div className="form-field emoji-field">
                <label>Emoji</label>
                <select
                  value={form.emoji}
                  onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                >
                  {/* Keep the current emoji selectable even if it's not a preset */}
                  {!EMOJI_PRESETS.includes(form.emoji) && <option value={form.emoji}>{form.emoji}</option>}
                  {EMOJI_PRESETS.map(em => <option key={em} value={em}>{em}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={modal.type === 'grind' ? 'e.g. Reading' : 'e.g. Basketball'}
                  autoFocus
                />
              </div>
            </div>

            <div className="form-field">
              <label>How do you track it?</label>
              <div className="segmented">
                <button
                  className={form.valueType === 'duration' ? 'active' : ''}
                  onClick={() => setForm({ ...form, valueType: 'duration' })}
                >⏱ By time</button>
                <button
                  className={form.valueType === 'counter' ? 'active' : ''}
                  onClick={() => setForm({ ...form, valueType: 'counter' })}
                >✔ By times done</button>
              </div>
            </div>

            <div className="form-field">
              <label>
                {modal.type === 'grind'
                  ? (form.valueType === 'duration' ? 'Minutes earned per hour' : 'Minutes earned per completion')
                  : (form.valueType === 'duration' ? 'Cost multiplier (1 = minute per minute)' : 'Minutes spent per use')}
              </label>
              <input
                type="number"
                min="0"
                step={modal.type === 'glow' && form.valueType === 'duration' ? '0.1' : '1'}
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              {modal.habit && (
                <button className="btn-danger" onClick={removeHabit}>Delete</button>
              )}
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveHabit} disabled={!form.name.trim()}>
                {modal.habit ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
