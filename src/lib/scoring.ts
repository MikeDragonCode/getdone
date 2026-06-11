import { ItemLog, HabitItem, DayScore } from './types';

export function calculateDailyMetrics(
  grindLogs: ItemLog[],
  glowLogs: ItemLog[],
  habits: HabitItem[]
): { earnedTimeDelta: number; scoreInfo: DayScore } {
  let earnedToday = 0;
  let spentToday = 0;

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
      spentToday += log.value * habit.costRate;
    }
  });

  const earnedTimeDelta = earnedToday - spentToday;

  // Score Calculation based on daily balance
  // Goal is to have a healthy mix of both, without hoarding too much or going negative.
  let score = 0;
  let label = 'Log your day';
  let labelClass = 'label-empty';

  if (earnedToday === 0 && spentToday === 0) {
    score = 0;
  } else if (earnedToday > 0 && spentToday === 0) {
    // Grinding without glowing
    score = 60;
    label = 'You earned a break 💜';
    labelClass = 'label-grind';
  } else if (spentToday > 0 && earnedToday === 0) {
    // Glowing without grinding
    score = 30;
    label = 'Time to grind 🔥';
    labelClass = 'label-glow';
  } else {
    // Mix of both
    // Perfect is if spent is roughly equal to earned (or slightly less to build a bank)
    const ratio = spentToday / earnedToday; // 1.0 is balanced
    if (ratio >= 0.8 && ratio <= 1.2) {
      score = 100;
      label = 'Perfect Balance ✦';
      labelClass = 'label-balanced';
    } else if (ratio < 0.8) {
      score = 80;
      label = 'Great Day (Saved Time)';
      labelClass = 'label-balanced';
    } else {
      score = 50;
      label = 'Borrowed Time';
      labelClass = 'label-glow';
    }
  }

  return {
    earnedTimeDelta,
    scoreInfo: { score, label, labelClass }
  };
}
