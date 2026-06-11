'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Trophy, Play, Square, Pencil, Plus, Wind, Moon, Sparkles } from 'lucide-react';
import { HabitItem, ItemLog, DayLog, UserData } from '../lib/types';
import { getUserData, saveUserData, initUserData, getTodayDate, getTodayLog, saveDayLog, getStreak, getBestStreak, getLast7Days, isRestDay, upsertHabit, deleteHabit } from '../lib/store';
import { calculateDailyMetrics } from '../lib/scoring';

const currentWindow = (): 'morning' | 'day' | 'evening' => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
};

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
  const [form, setForm] = useState({ name: '', emoji: '', valueType: 'duration' as 'duration' | 'counter', rate: '', window: 'any' as NonNullable<HabitItem['window']> });
  const [recap, setRecap] = useState<DayLog | null>(null);
  const [timer, setTimer] = useState<{ habitId: string; type: 'grind' | 'glow'; startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [nudge, setNudge] = useState<string | null>(null);
  const [streakOpen, setStreakOpen] = useState(false);
  // Highest chunk we've already nudged about — prevents repeat fires while a timer runs
  const lastNudgedChunk = useRef(0);

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

    // End of day recap: show the most recent past day once
    const prior = userData.logs
      .filter((l) => l.date < date && l.score > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop();
    if (prior && userData.lastRecapDate !== prior.date) {
      setRecap(prior);
    }
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

  const triggerNudge = (bankedMins: number) => {
    const msg = `You've banked ${bankedMins} min. Go be yourself.`;
    setNudge(msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('GetDone', { body: `🛋 Time to unwind — ${msg}` });
    }
  };

  // While a grind timer runs, project the bank forward and nudge live —
  // don't wait for the user to press Stop
  useEffect(() => {
    if (!timer || timer.type !== 'grind' || !data) return;
    const habit = data.habits.find(h => h.id === timer.habitId);
    if (!habit?.earnRate || habit.valueType !== 'duration') return;
    const projected = data.earnedTimeBank + ((now - timer.startedAt) / 60000) * habit.earnRate;
    const baseChunk = Math.floor(Math.max(0, data.earnedTimeBank) / BREAK_CHUNK_MINS);
    const chunk = Math.floor(Math.max(0, projected) / BREAK_CHUNK_MINS);
    if (chunk > baseChunk && chunk > lastNudgedChunk.current) {
      lastNudgedChunk.current = chunk;
      triggerNudge(chunk * BREAK_CHUNK_MINS);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

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
    
    const restToday = isRestDay(data);
    const metrics = calculateDailyMetrics(newLog.grindLogs, newLog.glowLogs, data.habits, restToday);
    newLog.earnedTimeDelta = metrics.earnedTimeDelta;
    newLog.score = metrics.scoreInfo.score;

    // Show toast (whole minutes — 3.75 reads as noise, 4 reads as a reward)
    if (type === 'grind') {
      const earned = Math.round(amount * (habit.earnRate || 0));
      showToast(`Nice! +${earned} min earned`, 'grind');
    } else {
      const spent = Math.round(amount * (habit.costRate || 0) * (restToday ? 0.5 : 1));
      showToast(restToday ? `Rest day deal! -${spent} min spent` : `Enjoy! -${spent} min spent`, 'glow');
    }

    setTodayLog(newLog);
    saveDayLog(newLog, data);

    const newData = getUserData();
    if (newData) setData(newData);

    // Apple-Watch-style nudge: every BREAK_CHUNK_MINS earned, remind to unwind
    if (type === 'grind' && newData) {
      const before = Math.floor(Math.max(0, bankBefore) / BREAK_CHUNK_MINS);
      const after = Math.floor(Math.max(0, newData.earnedTimeBank) / BREAK_CHUNK_MINS);
      if (after > before && after > lastNudgedChunk.current) {
        lastNudgedChunk.current = after;
        triggerNudge(after * BREAK_CHUNK_MINS);
      }
    }
  };

  const openModal = (type: 'grind' | 'glow', habit: HabitItem | null) => {
    if (habit) {
      // Rates are shown in friendly units (see saveHabit for the reverse mapping)
      const rate = habit.type === 'grind'
        ? (habit.valueType === 'duration' ? (habit.earnRate || 0) * 60 : habit.earnRate || 0)
        : (habit.valueType === 'duration' ? habit.costRate || 1 : habit.costRate || 0);
      setForm({ name: habit.name, emoji: habit.emoji, valueType: habit.valueType, rate: String(rate), window: habit.window || 'any' });
    } else {
      setForm({ name: '', emoji: type === 'grind' ? '🔥' : '✨', valueType: 'duration', rate: type === 'grind' ? '15' : '1', window: 'any' });
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
      habit.window = form.window;
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
    const metrics = calculateDailyMetrics(newLog.grindLogs, newLog.glowLogs, newData.habits, isRestDay(newData));
    newLog.earnedTimeDelta = metrics.earnedTimeDelta;
    newLog.score = metrics.scoreInfo.score;
    setTodayLog(newLog);
    saveDayLog(newLog, newData);
    setData({ ...newData });
    setModal(null);
  };

  const recalcToday = (userData: UserData) => {
    const metrics = calculateDailyMetrics(todayLog.grindLogs, todayLog.glowLogs, userData.habits, isRestDay(userData));
    const newLog = { ...todayLog, earnedTimeDelta: metrics.earnedTimeDelta, score: metrics.scoreInfo.score };
    setTodayLog(newLog);
    saveDayLog(newLog, userData);
  };

  const streak = getStreak(data);
  const week = getLast7Days(data);
  const restToday = isRestDay(data);
  const bankMins = Math.floor(data.earnedTimeBank);

  // Glow suggestion: random pick among habits that fit the current time of day
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestion = useMemo(() => {
    if (bankMins < 15) return null;
    const win = currentWindow();
    const candidates = data.habits.filter(
      h => h.type === 'glow' && (!h.window || h.window === 'any' || h.window === win)
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }, [bankMins, data.habits]);

  const dismissRecap = () => {
    if (!recap) return;
    const d = { ...data, lastRecapDate: recap.date };
    saveUserData(d);
    setData(d);
    setRecap(null);
  };
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
          <p className="subtitle">
            {restToday ? 'Rest day — glow is 50% off 🦥' : 'Done for today. Go be yourself.'}
          </p>
        </div>
        <button className="streak" onClick={() => setStreakOpen(true)}>
          <Flame size={22} className="streak-flame" fill="currentColor" />
          <span className="streak-count">{streak}</span>
        </button>
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
          {isBankPositive ? (bankMins > 0 ? 'You earned it' : 'Time to grind') : 'In debt'}
        </div>
      </section>

      {suggestion && (
        <motion.section
          className="suggestion"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Sparkles size={16} className="suggestion-icon" />
          <span>
            You&apos;ve got <b>{bankMins}m</b> — enough for {suggestion.emoji} <b>{suggestion.name}</b>
          </span>
        </motion.section>
      )}

      <section className="weekly-rhythm">
        {/* Today first, going back in time — a streak burns left to right */}
        {week.slice().reverse().map((d, i) => {
          const dayLetter = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d.date + 'T00:00').getDay()];
          const active = d.score > 20;
          const isToday = i === 0;
          return (
            <div key={d.date} className="rhythm-day">
              <div className={`rhythm-dot ${active ? 'active' : ''} ${isToday ? 'today' : ''}`}>
                {active && <Flame size={15} fill="currentColor" />}
              </div>
              <span className="rhythm-label">{dayLetter}</span>
            </div>
          );
        })}
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
                        Earn <span className="rate-value">{habit.valueType === 'duration' ? `${habit.earnRate! * 60}` : `${habit.earnRate}`}</span><span className="dot dot-glow rate-dot"></span> {habit.valueType === 'duration' ? 'per hr' : 'per done'}
                      </div>
                    </div>
                    <button className="btn-edit" onClick={() => openModal('grind', habit)} aria-label="Edit habit"><Pencil size={13} /></button>
                  </div>
                  <div className="habit-controls">
                    {habit.valueType === 'duration' ? (
                      <>
                        {timer?.habitId === habit.id ? (
                          <button className="btn-timer-main timer-active grind" onClick={stopTimer}>
                            <Square size={11} fill="currentColor" /> {formatElapsed(now - timer.startedAt)}
                          </button>
                        ) : (
                          <button className="btn-timer-main grind" onClick={() => startTimer(habit.id, 'grind')} disabled={!!timer}><Play size={12} fill="currentColor" /> Start</button>
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
            <button className="btn-add-habit grind-add" onClick={() => openModal('grind', null)}><Plus size={14} /> Add activity</button>
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
                        Cost <span className="rate-value">{habit.costRate}x</span><span className="dot dot-glow rate-dot"></span>
                      </div>
                    </div>
                    <button className="btn-edit" onClick={() => openModal('glow', habit)} aria-label="Edit habit"><Pencil size={13} /></button>
                  </div>
                  <div className="habit-controls">
                    {habit.valueType === 'duration' ? (
                      <>
                        {timer?.habitId === habit.id ? (
                          <button className="btn-timer-main timer-active glow" onClick={stopTimer}>
                            <Square size={11} fill="currentColor" /> {formatElapsed(now - timer.startedAt)}
                          </button>
                        ) : (
                          <button className="btn-timer-main glow" onClick={() => startTimer(habit.id, 'glow')} disabled={!!timer}><Play size={12} fill="currentColor" /> Start</button>
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
            <button className="btn-add-habit glow-add" onClick={() => openModal('glow', null)}><Plus size={14} /> Add activity</button>
          </div>
        </div>
      </section>

      {/* Streak history — Duolingo-style month calendar */}
      {streakOpen && (
        <div className="modal-overlay" onClick={() => setStreakOpen(false)}>
          <div className="modal streak-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Your streak</h3>

            <div className="streak-stats">
              <div className="streak-stat">
                <span className="streak-stat-value"><Flame size={20} fill="currentColor" className="icon-grind" /> {streak}</span>
                <span className="streak-stat-label">Current</span>
              </div>
              <div className="streak-stat">
                <span className="streak-stat-value"><Trophy size={20} className="icon-glow" /> {getBestStreak(data)}</span>
                <span className="streak-stat-label">Best</span>
              </div>
            </div>

            <div className="calendar">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={`h${i}`} className="cal-head">{d}</div>
              ))}
              {(() => {
                const today = new Date();
                const first = new Date(today.getFullYear(), today.getMonth(), 1);
                const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
                const cells = [];
                for (let i = 0; i < first.getDay(); i++) {
                  cells.push(<div key={`e${i}`} />);
                }
                for (let day = 1; day <= daysInMonth; day++) {
                  const d = new Date(today.getFullYear(), today.getMonth(), day);
                  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const log = data.logs.find(l => l.date === dateStr);
                  const active = log && log.score > 20;
                  const rest = (data.restDays || []).includes(d.getDay());
                  const future = d > today;
                  const isToday = day === today.getDate();
                  cells.push(
                    <div key={day} className={`cal-day ${active ? 'active' : ''} ${rest && !active ? 'rest' : ''} ${future ? 'future' : ''} ${isToday ? 'today' : ''}`}>
                      {active ? <Flame size={13} fill="currentColor" className="icon-grind" /> : rest && !future ? <Moon size={11} /> : day}
                    </div>
                  );
                }
                return cells;
              })()}
            </div>

            <p className="streak-hint">
              <Moon size={12} /> Rest days never break your streak.
            </p>

            <button className="btn-primary" onClick={() => setStreakOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Break nudge — full-screen moment, not a passing toast */}
      <AnimatePresence>
        {nudge && (
          <div className="modal-overlay nudge-overlay" onClick={() => setNudge(null)}>
            <motion.div
              className="nudge-card"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <motion.div
                className="nudge-icon"
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
              >
                <Wind size={48} />
              </motion.div>
              <h2 className="nudge-title">Time to exhale</h2>
              <p className="nudge-text">{nudge}</p>
              <button className="btn-primary nudge-btn" onClick={() => setNudge(null)}>Got it</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* End of day recap */}
      <AnimatePresence>
        {recap && !nudge && (
          <div className="modal-overlay nudge-overlay" onClick={dismissRecap}>
            <motion.div
              className="nudge-card recap-card"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <div className="nudge-icon"><Sparkles size={44} /></div>
              <h2 className="nudge-title">
                {new Date(recap.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'long' })}, closed.
              </h2>
              <div className="recap-stats">
                <div className="recap-stat">
                  <span className="recap-value icon-grind">{recap.grindLogs.length}</span>
                  <span className="recap-label">Grind</span>
                </div>
                <div className="recap-stat">
                  <span className="recap-value icon-glow">{recap.glowLogs.length}</span>
                  <span className="recap-label">Glow</span>
                </div>
                <div className="recap-stat">
                  <span className="recap-value">{recap.score}</span>
                  <span className="recap-label">Score</span>
                </div>
              </div>
              <p className="nudge-text">
                {recap.earnedTimeDelta >= 0
                  ? `You banked +${Math.round(recap.earnedTimeDelta)} min. Carried into today.`
                  : `You treated yourself to ${Math.abs(Math.round(recap.earnedTimeDelta))} min. Worth it.`}
              </p>
              <button className="btn-primary nudge-btn" onClick={dismissRecap}>New day, let&apos;s go</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

            {modal.type === 'glow' && (
              <div className="form-field">
                <label>When does it fit?</label>
                <div className="segmented">
                  {(['any', 'morning', 'day', 'evening'] as const).map(w => (
                    <button
                      key={w}
                      className={form.window === w ? 'active' : ''}
                      onClick={() => setForm({ ...form, window: w })}
                    >
                      {w === 'any' ? 'Any' : w === 'morning' ? 'Morning' : w === 'day' ? 'Day' : 'Evening'}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
