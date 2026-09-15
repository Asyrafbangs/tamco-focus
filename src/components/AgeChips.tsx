import { ageChips } from '@/domain/duration';
import type { TaskOverview } from '@/domain/types';
import type { ReactNode } from 'react';

/**
 * Compact task-age indicators (section 31B.6).
 *
 * Every chip carries a written label and an explanation, so the meaning never
 * depends on colour alone (section 1.3, item 12). The explanation is both the
 * tooltip and the accessible description.
 */
export function AgeChips({
  task,
  staleThresholdDays,
  now,
  timeZone,
  trailingAction,
}: {
  task: TaskOverview;
  staleThresholdDays?: number;
  now?: Date;
  timeZone?: string;
  trailingAction?: ReactNode;
}) {
  const chips = ageChips(task, { staleThresholdDays, now, timeZone });

  const toneClass = {
    neutral: 'neutral',
    blue: 'blue',
    red: 'red',
    amber: 'amber',
  } as const;

  return (
    <div className="age-row">
      {chips.map((chip, index) => {
        const indicator = (
          <span className={`flag ${toneClass[chip.tone]}`} title={chip.explanation}>
            {chip.label}
            <span className="visually-hidden">. {chip.explanation}</span>
          </span>
        );

        return index === chips.length - 1 && trailingAction ? (
          <span key={chip.label} className="age-row-tail">
            {indicator}
            {trailingAction}
          </span>
        ) : (
          <span key={chip.label} className="age-row-item">
            {indicator}
          </span>
        );
      })}
      {chips.length === 0 && trailingAction}
    </div>
  );
}
