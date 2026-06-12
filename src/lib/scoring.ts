import { ItemLog, HabitItem, DayScore } from './types';

// On rest days glow is half price and glow-only days are celebrated, not shamed
export const REST_DAY_GLOW_DISCOUNT = 0.5;

export function calculateDailyMetrics(
  grindLogs: ItemLog[],
  glowLogs: ItemLog[],
  habits: HabitItem[],
  restDay = false,
  dailyGrindHours = 8
): { earnedTimeDelta: number; scoreInfo: DayScore } {
  let earnedToday = 0;
  let spentToday = 0;
  const glowMultiplier = restDay ? REST_DAY_GLOW_DISCOUNT : 1;

  // Calculate earned time
  grindLogs.forEach(log => {
    const habit = habits.find(h => h.id === log.habitId);
    if (habit && habit.earnRate) {
      earnedToday += log.value * habit.earnRate;
    }
  });

  // Calculate spent time
  glowLogs.forEach(log => {
    const habit = habits.find(h => h.id === log.habitId);
    if (habit && habit.costRate) {
      spentToday += log.value * habit.costRate * glowMultiplier;
    }
  });

  const earnedTimeDelta = earnedToday - spentToday;

  // Score Calculation based on daily balance
  // Goal is to have a healthy mix of both, without hoarding too much or going negative.
  let score = 0;
  let label = 'Log your day';
  let labelClass = 'label-empty';

  // A "real" day needs volume, scaled to the user's typical schedule:
  // ~40% of what a full grind day would bank at the default 15m/hr rate.
  // Light (3h) → 18m, standard (8h) → 48m, heavy (12h) → 72m. Without it,
  // ratios are meaningless — 15 min of work + 4 min of gaming must not
  // read as "Perfect Balance" for anyone but a true 1h-a-day schedule.
  const MIN_MEANINGFUL_EARN = Math.max(15, Math.round(dailyGrindHours * 60 * 0.25 * 0.4));

  if (earnedToday === 0 && spentToday === 0) {
    score = 0;
  } else if (spentToday > 0 && earnedToday === 0) {
    if (restDay) {
      // That's exactly what a rest day is for
      score = 80;
      label = 'Rest day — enjoy';
      labelClass = 'label-balanced';
    } else {
      score = 25;
      label = 'Time to grind';
      labelClass = 'label-glow';
    }
  } else if (earnedToday < MIN_MEANINGFUL_EARN) {
    // Some grind logged (with or without glow), but the day is still young
    score = 40;
    label = 'Warming up';
    labelClass = 'label-grind';
  } else if (spentToday === 0) {
    // Real work done, no rest taken yet
    score = 60;
    label = 'You earned a break';
    labelClass = 'label-grind';
  } else {
    // Meaningful grind + some glow: judge the balance
    const ratio = spentToday / earnedToday; // 1.0 = spent what you earned
    if (ratio >= 0.5 && ratio <= 1.2) {
      score = 100;
      label = 'Perfect Balance ✦';
      labelClass = 'label-balanced';
    } else if (ratio < 0.5) {
      score = 75;
      label = 'Saved time';
      labelClass = 'label-balanced';
    } else {
      score = 50;
      label = 'Borrowed time';
      labelClass = 'label-glow';
    }
  }

  return {
    earnedTimeDelta,
    scoreInfo: { score, label, labelClass }
  };
}
