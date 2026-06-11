import { UserData, DayLog, HabitItem } from './types';

const STORE_KEY = 'getdone_data_v2';

export function getUserData(): UserData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveUserData(data: UserData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export function initUserData(habits: HabitItem[]): UserData {
  const data: UserData = {
    habits,
    logs: [],
    earnedTimeBank: 0,
    onboardingComplete: false,
    createdAt: new Date().toISOString(),
  };
  saveUserData(data);
  return data;
}

export function getTodayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getTodayLog(data: UserData): DayLog | null {
  const today = getTodayDate();
  return data.logs.find((l) => l.date === today) || null;
}

export function saveDayLog(log: DayLog, data: UserData): void {
  const idx = data.logs.findIndex((l) => l.date === log.date);
  
  // Calculate delta difference to update the global time bank correctly
  let previousDelta = 0;
  if (idx >= 0) {
    previousDelta = data.logs[idx].earnedTimeDelta;
    data.logs[idx] = log;
  } else {
    data.logs.push(log);
  }
  
  data.earnedTimeBank += (log.earnedTimeDelta - previousDelta);
  
  saveUserData(data);
}

export function upsertHabit(data: UserData, habit: HabitItem): UserData {
  const idx = data.habits.findIndex((h) => h.id === habit.id);
  if (idx >= 0) {
    data.habits[idx] = habit;
  } else {
    data.habits.push(habit);
  }
  saveUserData(data);
  return data;
}

// Removes the habit definition. Past days keep their earned/spent history
// (the bank is not retroactively recalculated) — only today's entries for
// this habit should be scrubbed by the caller before deleting.
export function deleteHabit(data: UserData, habitId: string): UserData {
  data.habits = data.habits.filter((h) => h.id !== habitId);
  saveUserData(data);
  return data;
}

export function getStreak(data: UserData): number {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const log = data.logs.find((l) => l.date === dateStr);
    if (log && log.score > 20) { // arbitrary threshold for now
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

export function getLast7Days(data: UserData): { date: string; score: number }[] {
  const result = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const log = data.logs.find((l) => l.date === dateStr);
    result.push({ date: dateStr, score: log?.score || 0 });
  }
  return result;
}
