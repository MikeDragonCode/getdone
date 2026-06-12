'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Trophy, Play, Square, Plus, Wind, Moon, Sparkles, Settings, RotateCcw, Share2 } from 'lucide-react';
import { HabitItem, ItemLog, DayLog, UserData } from '../lib/types';
import { getUserData, saveUserData, initUserData, resetUserData, getTodayDate, getTodayLog, saveDayLog, getStreak, getBestStreak, getLast7Days, isRestDay, upsertHabit, deleteHabit } from '../lib/store';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'grind' | 'glow'>('grind');
  const [resetArmed, setResetArmed] = useState(false);
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

  // Hooks must run unconditionally — keep every useMemo above the early return
  const bankMins = data ? Math.floor(data.earnedTimeBank) : 0;

  // Glow suggestion: deterministic pick per day+time-of-day window so the
  // text doesn't reshuffle (and reflow the page) on every bank change
  const suggestion = useMemo(() => {
    if (!data || bankMins < 15) return null;
    const win = currentWindow();
    const candidates = data.habits.filter(
      h => h.type === 'glow' && (!h.window || h.window === 'any' || h.window === win)
    );
    if (candidates.length === 0) return null;
    const seed = `${getTodayDate()}-${win}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    return candidates[Math.abs(hash) % candidates.length];
  }, [bankMins >= 15, data]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Renders the recap as a story-sized image and opens the native share sheet
  const shareRecap = async (log: DayLog) => {
    const W = 1080, H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#13111c';
    ctx.fillRect(0, 0, W, H);

    // Soft glow blobs
    const glow = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, 500);
    glow.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
    glow.addColorStop(1, 'rgba(168, 85, 247, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const warm = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.15, H * 0.85, 500);
    warm.addColorStop(0, 'rgba(251, 146, 60, 0.18)');
    warm.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    const font = (size: number, weight = 800) =>
      `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

    // Logo
    ctx.fillStyle = '#f8f7fa';
    ctx.font = font(72);
    ctx.textAlign = 'left';
    ctx.fillText('GetDone.', 80, 150);
    ctx.fillStyle = '#9f9bad';
    ctx.font = font(34, 600);
    ctx.fillText('Done for today. Go be yourself.', 80, 210);

    // Weekday
    const weekday = new Date(log.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    ctx.fillStyle = '#a855f7';
    ctx.font = font(54);
    ctx.fillText(weekday, 80, 380);
    ctx.fillStyle = '#f8f7fa';
    ctx.font = font(96);
    ctx.fillText('Closed.', 80, 490);

    // Stat tiles
    const stats = [
      { label: 'GRIND', value: String(log.grindLogs.length), color: '#fb923c' },
      { label: 'GLOW', value: String(log.glowLogs.length), color: '#a855f7' },
      { label: 'SCORE', value: String(log.score), color: '#10b981' },
    ];
    stats.forEach((s, i) => {
      const x = 80 + i * 320;
      const y = 600;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.roundRect(x, y, 280, 240, 28);
      ctx.fill();
      ctx.fillStyle = s.color;
      ctx.font = font(96);
      ctx.textAlign = 'center';
      ctx.fillText(s.value, x + 140, y + 130);
      ctx.fillStyle = '#9f9bad';
      ctx.font = font(28, 700);
      ctx.fillText(s.label, x + 140, y + 195);
    });

    // Banked line
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8f7fa';
    ctx.font = font(46, 700);
    const delta = Math.round(log.earnedTimeDelta);
    ctx.fillText(
      delta >= 0 ? `Banked +${delta} min of guilt-free time` : `Treated myself to ${Math.abs(delta)} min. Worth it.`,
      80, 980
    );

    // Streak
    ctx.fillStyle = '#fb923c';
    ctx.font = font(46);
    ctx.fillText(`🔥 ${getStreak(data!)} day streak`, 80, 1070);

    // Footer
    ctx.fillStyle = '#9f9bad';
    ctx.font = font(32, 600);
    ctx.fillText('getdone-rust.vercel.app', 80, 1270);

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'getdone-recap.png', { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'My day on GetDone' });
        return;
      } catch { /* user cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'getdone-recap.png';
    a.click();
    URL.revokeObjectURL(url);
  };

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
            {restToday ? 'Rest day — glow is 50% off' : 'Grind. Glow. Repeat.'}
          </p>
        </div>
        <div className="header-actions">
          <button className="streak" onClick={() => setStreakOpen(true)}>
            <Flame size={22} className="streak-flame" fill="currentColor" />
            <span className="streak-count">{streak}</span>
          </button>
          <button className="btn-settings" onClick={() => { setResetArmed(false); setSettingsOpen(true); }} aria-label="Settings">
            <Settings size={20} />
          </button>
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
          {/* The motto is a reward: it only appears once the day is balanced */}
          {isBankPositive
            ? (todayLog.score >= 80
              ? 'Done for today. Go be yourself.'
              : bankMins > 0 ? 'You earned it' : 'Time to grind')
            : 'In debt'}
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

      {/* Subtle 7-day strip — the full calendar lives behind the streak chip */}
      <button className="weekly-rhythm" onClick={() => setStreakOpen(true)} aria-label="Streak history">
        {week.slice().reverse().map((d, i) => {
          const active = d.score > 20;
          const isToday = i === 0;
          return (
            <span key={d.date} className={`rhythm-mini-dot ${active ? 'active' : ''} ${isToday ? 'today' : ''}`} />
          );
        })}
      </button>

      {/* Duolingo-style: one focused list, tabs to switch worlds */}
      <section className="habits-section">
        <div className="tab-switcher">
          <button
            className={`tab tab-grind ${activeTab === 'grind' ? 'active' : ''}`}
            onClick={() => setActiveTab('grind')}
          >
            <span className="dot dot-grind"></span> Grind
          </button>
          <button
            className={`tab tab-glow ${activeTab === 'glow' ? 'active' : ''}`}
            onClick={() => setActiveTab('glow')}
          >
            <span className="dot dot-glow"></span> Glow
          </button>
        </div>

        <div className="habit-list">
          {(activeTab === 'grind' ? grindHabits : glowHabits).map(habit => {
            const logs = activeTab === 'grind' ? todayLog.grindLogs : todayLog.glowLogs;
            const val = logs.find(l => l.habitId === habit.id)?.value || 0;
            const isRunning = timer?.habitId === habit.id;
            return (
              <motion.div
                key={habit.id}
                className={`habit-row ${activeTab} ${isRunning ? 'running' : ''}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="habit-emoji">{habit.emoji}</div>
                <div className="habit-info" onClick={() => openModal(activeTab, habit)} role="button">
                  <div className="habit-name">{habit.name}</div>
                  <div className="habit-rate">
                    {activeTab === 'grind' ? (
                      <>Earn <span className="rate-value">{habit.valueType === 'duration' ? habit.earnRate! * 60 : habit.earnRate}</span><span className="dot dot-glow rate-dot"></span> {habit.valueType === 'duration' ? '/hr' : '/done'}</>
                    ) : (
                      <>Cost <span className="rate-value">{habit.costRate}x</span><span className="dot dot-glow rate-dot"></span></>
                    )}
                    {val > 0 && <span className="logged-inline"> · today {habit.valueType === 'duration' ? `${val}m` : `×${val}`}</span>}
                  </div>
                </div>
                <div className="row-actions">
                  {habit.valueType === 'duration' ? (
                    <>
                      <button className="btn-quick" onClick={() => addIncrement(habit.id, activeTab, 15)}>
                        {activeTab === 'grind' ? '+15' : '-15'}
                      </button>
                      <button className="btn-quick" onClick={() => addIncrement(habit.id, activeTab, 60)}>
                        {activeTab === 'grind' ? '+1h' : '-1h'}
                      </button>
                      {isRunning ? (
                        <button className={`btn-row-timer timer-active ${activeTab}`} onClick={stopTimer}>
                          <Square size={10} fill="currentColor" /> {formatElapsed(now - timer.startedAt)}
                        </button>
                      ) : (
                        <button className={`btn-row-timer ${activeTab}`} onClick={() => startTimer(habit.id, activeTab)} disabled={!!timer}>
                          <Play size={12} fill="currentColor" />
                        </button>
                      )}
                    </>
                  ) : (
                    <button className={`btn-row-timer ${activeTab}`} onClick={() => addIncrement(habit.id, activeTab, 1)}>+1</button>
                  )}
                </div>
              </motion.div>
            );
          })}
          <button className={`btn-add-habit ${activeTab}-add`} onClick={() => openModal(activeTab, null)}>
            <Plus size={14} /> Add activity
          </button>
        </div>
      </section>

      {/* Settings */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Settings</h3>

            <div className="form-field">
              <label>Rest days</label>
              <div className="rest-days-row">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, day) => {
                  const selected = (data.restDays || []).includes(day);
                  return (
                    <button
                      key={day}
                      className={`rest-day-chip ${selected ? 'active' : ''}`}
                      onClick={() => {
                        const next = selected
                          ? (data.restDays || []).filter(d => d !== day)
                          : [...(data.restDays || []), day];
                        const d = { ...data, restDays: next };
                        saveUserData(d);
                        setData(d);
                        recalcToday(d);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">Glow is 50% off on rest days, and your streak never breaks.</p>
            </div>

            <div className="form-field danger-zone">
              <label>Danger zone</label>
              {!resetArmed ? (
                <button className="btn-danger btn-reset" onClick={() => setResetArmed(true)}>
                  <RotateCcw size={14} /> Start over
                </button>
              ) : (
                <>
                  <p className="field-hint danger-hint">
                    This wipes all habits, history and your time bank. No way back.
                  </p>
                  <div className="reset-confirm-row">
                    <button className="btn-secondary" onClick={() => setResetArmed(false)}>Keep my data</button>
                    <button
                      className="btn-danger btn-reset"
                      onClick={() => {
                        resetUserData();
                        window.location.href = '/onboarding';
                      }}
                    >
                      Yes, wipe everything
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

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
              <div className="recap-actions">
                <button className="btn-secondary recap-share" onClick={() => shareRecap(recap)}>
                  <Share2 size={15} /> Share
                </button>
                <button className="btn-primary nudge-btn" onClick={dismissRecap}>New day, let&apos;s go</button>
              </div>
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
                {/* iOS ignores text-align on <select>: centered span + invisible select on top */}
                <div className="emoji-select">
                  {form.emoji}
                  <select
                    value={form.emoji}
                    onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                    aria-label="Emoji"
                  >
                    {/* Keep the current emoji selectable even if it's not a preset */}
                    {!EMOJI_PRESETS.includes(form.emoji) && <option value={form.emoji}>{form.emoji}</option>}
                    {EMOJI_PRESETS.map(em => <option key={em} value={em}>{em}</option>)}
                  </select>
                </div>
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
