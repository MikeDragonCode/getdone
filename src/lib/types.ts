export interface HabitItem {
  id: string;
  name: string;
  emoji: string;
  type: 'grind' | 'glow';
  valueType: 'duration' | 'counter';
  // For grind: How many glow minutes earned per 1 unit (minute or count)
  // e.g. 120 mins work = 30 mins glow => earnRate = 0.25
  earnRate?: number;
  // For glow: How many minutes it costs per 1 unit (minute or count)
  // e.g. 1 min PS5 = 1 min spent => costRate = 1.0
  costRate?: number;
}

export interface ItemLog {
  habitId: string;
  value: number; // minutes or count logged
}

export interface DayLog {
  date: string; // YYYY-MM-DD
  grindLogs: ItemLog[];
  glowLogs: ItemLog[];
  earnedTimeDelta: number; // How much time was added/subtracted TODAY
  score: number;
}

export interface UserData {
  habits: HabitItem[];
  logs: DayLog[];
  earnedTimeBank: number; // TOTAL accumulated minutes available to spend
  onboardingComplete: boolean;
  createdAt: string;
  // Days of week (0=Sun..6=Sat) the user doesn't grind: glow is discounted
  // and the streak doesn't break. Supports 5/2, 2/2, part-time schedules.
  restDays?: number[];
}

export interface DayScore {
  score: number;
  label: string;
  labelClass: string;
}
