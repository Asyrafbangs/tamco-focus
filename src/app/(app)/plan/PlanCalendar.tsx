'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type FormEvent,
} from 'react';

import { Modal } from '@/components/ui/Modal';
import { CalendarItem, Toast } from '@/components/ui/ParityPrimitives';
import { latestPlausibleDate } from '@/domain/delivery';
import { changeTaskDueDate } from '@/server/actions/task-actions';
import type { PlanEvent } from '@/server/queries';

/**
 * v153 — the Monthly Plan grid, where a due date can be dragged to another day.
 *
 * The Product Owner asked for the calendar to move like Outlook's. §17.3 still
 * holds — "it must not allow ungoverned drag-and-drop changes to due date" —
 * and what keeps this on the right side of it is that nothing here decides
 * anything. A drop calls `changeTaskDueDate`, the same action the task
 * drawer's Edit due date calls, so the same authority check, the same refusal
 * of closed work, the same version guard and the same audit event apply. The
 * calendar only knows which items to OFFER as movable, and the server decides
 * again on every call.
 *
 * Only due dates move. Routine occurrences follow their schedule, a "Review
 * by" date belongs to its review, and a meeting has other people in it; all
 * three render exactly as before.
 *
 * Every drag has a non-drag equivalent — "Move to…" beside each movable item —
 * because a gesture that needs a mouse held down is not available to somebody
 * on a keyboard, a switch, or a phone (WCAG 2.5.7). On the mobile agenda it is
 * the only route: touch screens do not fire HTML drag events, and an agenda
 * that hides empty days has nowhere to drop on anyway.
 */

/** What a due date needs in order to move, and nothing more. */
export type PlanCalendarMove =
  | { version: number; dueIsDateOnly: true }
  | {
      version: number;
      dueIsDateOnly: false;
      /**
       * Organisation-local wall-clock time, `HH:mm`. Moving a 14:30 commitment
       * to Thursday makes it due at 14:30 on Thursday, which is what dragging
       * it means; the drawer's editor is where the time itself changes.
       */
      localTime: string;
    };

export interface PlanCalendarItem {
  key: string;
  taskId: string;
  href: string;
  kind: PlanEvent['eventKind'];
  /** The title the cell shows — since v163 without a "Due:" style prefix. */
  label: string;
  /** The task's own title, for the dialog and the confirmation. */
  taskTitle: string;
  owner?: string;
  /** v163 — the one state worth a chip: late, or up for review. */
  status?: 'overdue' | 'review';
  /** v163 — the one fact beside the type: who owes a step, what it is part of, steps due. */
  relation?: string;
  /** v163 — the full sentence on hover. */
  tooltip?: string;
  accessibleSuffix: string;
  /** Present only when this viewer may move this due date. */
  move?: PlanCalendarMove;
  /** Set while a move is being saved, so the entry can say so. */
  saving?: boolean;
}

export interface PlanCalendarDay {
  /** Organisation-local `YYYY-MM-DD`. */
  date: string;
  dayNumber: number;
  /** The full date, for the agenda and for screen readers. */
  heading: string;
  isToday: boolean;
  items: PlanCalendarItem[];
}

/*
 * A type of our own rather than `text/plain`, so a cell only ever reacts to an
 * item dragged from this calendar — not to a file, a link from another tab, or
 * a selection of text somebody happened to drag across the grid.
 */
const DRAG_TYPE = 'application/x-tamco-due-date';

// §7.3 — Undo lasts about ten seconds, the same as it does on My Focus.
const UNDO_WINDOW_MS = 10_000;

function formatDay(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function dueValueFor(date: string, move: PlanCalendarMove) {
  return move.dueIsDateOnly ? date : `${date}T${move.localTime}`;
}

interface Relocation {
  taskId: string;
  toDate: string;
}

/**
 * The grid as it will look once the move is saved.
 *
 * Shown straight away and discarded when the server answers: on success the
 * refreshed page already has the item on its new day, and on failure it is
 * back where it started without anybody having to put it there. A date outside
 * this month just leaves the grid, which is where it has gone.
 */
function relocate(days: PlanCalendarDay[], relocation: Relocation): PlanCalendarDay[] {
  let moving: PlanCalendarItem | undefined;
  const without = days.map((day) => {
    const index = day.items.findIndex(
      (item) => item.taskId === relocation.taskId && item.move !== undefined,
    );
    if (index === -1) return day;
    moving = { ...day.items[index]!, saving: true };
    return { ...day, items: day.items.filter((_, position) => position !== index) };
  });
  if (!moving) return days;
  const arriving = moving;
  return without.map((day) =>
    day.date === relocation.toDate ? { ...day, items: [...day.items, arriving] } : day,
  );
}

/**
 * The month as rows of seven, the leading blanks included.
 *
 * A table has to have rows. The previous markup put its cells straight inside
 * the container, which axe reports as a broken structure and which a screen
 * reader cannot navigate by week. Each row is `display: contents`, so the CSS
 * grid on the desktop and the stacked agenda on a phone lay out exactly as
 * they did.
 */
function weeksOf(days: PlanCalendarDay[], leadingBlanks: number) {
  const slots: Array<PlanCalendarDay | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...days,
  ];
  const weeks: Array<Array<PlanCalendarDay | null>> = [];
  for (let start = 0; start < slots.length; start += 7) weeks.push(slots.slice(start, start + 7));
  return weeks;
}

interface UndoOffer {
  taskId: string;
  /** The version the move produced, which the way back must quote. */
  version: number;
  move: PlanCalendarMove;
  fromDate: string;
}

interface Notice {
  id: number;
  text: string;
  undo?: UndoOffer;
}

interface Dragged {
  item: PlanCalendarItem;
  fromDate: string;
}

function MoveIcon() {
  // A calendar with an arrow through it. Drawn rather than taken from a font,
  // because Windows and macOS disagree about most arrow glyphs at this size.
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" focusable="false">
      <rect
        x="1.5"
        y="2.5"
        width="11"
        height="10"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M1.5 5.6h11M4.5 1v2.6M9.5 1v2.6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.4 9.1h5M7.9 7.6l1.5 1.5-1.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlanCalendar({
  monthLabel,
  weekdays,
  leadingBlanks,
  days,
}: {
  monthLabel: string;
  weekdays: readonly string[];
  leadingBlanks: number;
  days: PlanCalendarDay[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /*
   * Undo has a transition of its own. The move's stays pending until the
   * page refresh that follows it has landed, and an Undo disabled until then
   * cannot take focus at the moment it is offered - a disabled button
   * refuses focus silently, so the keyboard was left on nothing.
   */
  const [undoing, startUndo] = useTransition();
  // Nothing new starts while a move or an Undo is in flight.
  const busy = pending || undoing;
  const [shown, relocateOptimistically] = useOptimistic(days, relocate);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<Dragged | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState('');

  const dragged = useRef<Dragged | null>(null);
  // Counted against each other, because `dragleave` fires on every child the
  // pointer crosses, not only when it leaves the grid.
  const enterDepth = useRef(0);
  const undoButton = useRef<HTMLButtonElement>(null);
  const noticeCount = useRef(0);

  /**
   * Puts focus back on a task's entry once it has been drawn.
   *
   * After an Undo the button that had focus disappears, and the entry it
   * should land on only exists once the refreshed page has rendered, so this
   * looks for a moment rather than once.
   */
  const focusTask = useCallback((taskId: string) => {
    let attempts = 0;
    const tryFocus = () => {
      const entry = document.querySelector<HTMLElement>(`[data-plan-task="${taskId}"]`);
      if (entry) {
        entry.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < 20) window.setTimeout(tryFocus, 50);
      else document.querySelector<HTMLElement>('.calendar')?.focus({ preventScroll: true });
    };
    tryFocus();
  }, []);

  useEffect(() => {
    if (!notice) return;

    /*
     * Undo takes focus as soon as it is offered, as it does on My Focus.
     * When the move came from the dialog, that dialog returns focus to
     * whatever opened it 200 ms into closing — so wait until it has, or it
     * takes focus straight back.
     */
    const closingDialog = document.querySelector('.modal-layer');
    const focusTimer = notice.undo
      ? window.setTimeout(
          () => undoButton.current?.focus({ preventScroll: true }),
          closingDialog ? 210 : 0,
        )
      : null;

    const expiry = window.setTimeout(() => {
      // Only rescue focus if the expiring Undo still holds it; somebody who
      // has moved on to another control keeps their place.
      if (notice.undo && document.activeElement === undoButton.current) {
        focusTask(notice.undo.taskId);
      }
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, UNDO_WINDOW_MS);

    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      window.clearTimeout(expiry);
    };
  }, [focusTask, notice]);

  useEffect(() => {
    if (!failure) return;
    const expiry = window.setTimeout(() => setFailure(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(expiry);
  }, [failure]);

  const moveTo = useCallback(
    (item: PlanCalendarItem, fromDate: string, toDate: string) => {
      const move = item.move;
      if (!move || !toDate || toDate === fromDate) return;

      setFailure(null);
      setNotice(null);
      startTransition(async () => {
        relocateOptimistically({ taskId: item.taskId, toDate });
        const result = await changeTaskDueDate({
          taskId: item.taskId,
          expectedVersion: move.version,
          dueValue: dueValueFor(toDate, move),
          dueIsDateOnly: move.dueIsDateOnly,
          idempotencyKey: crypto.randomUUID(),
        });

        if (result.ok) {
          noticeCount.current += 1;
          setNotice({
            id: noticeCount.current,
            text: `Due date moved to ${formatDay(toDate)}.`,
            undo: {
              taskId: item.taskId,
              version: result.version ?? move.version + 1,
              move,
              fromDate,
            },
          });
          return;
        }

        setFailure(result.message);
        // Somebody else changed this work since the calendar was drawn. Their
        // version is the one to look at, so fetch it rather than leave a grid
        // that will refuse every further move of this item.
        if (result.code === 'version_conflict') router.refresh();
      });
    },
    [relocateOptimistically, router],
  );

  const undo = useCallback(() => {
    const offer = notice?.undo;
    if (!offer || undoing) return;

    startUndo(async () => {
      relocateOptimistically({ taskId: offer.taskId, toDate: offer.fromDate });
      /*
       * A second change back rather than an erasure: the audit trail reads
       * "moved, then moved back", which is what happened. `undo_event` has no
       * notion of a due date, and teaching it one would put a second route to
       * the same change beside the governed one.
       */
      const result = await changeTaskDueDate({
        taskId: offer.taskId,
        expectedVersion: offer.version,
        dueValue: dueValueFor(offer.fromDate, offer.move),
        dueIsDateOnly: offer.move.dueIsDateOnly,
        idempotencyKey: crypto.randomUUID(),
      });

      if (result.ok) {
        noticeCount.current += 1;
        setNotice({
          id: noticeCount.current,
          text: `Due date moved back to ${formatDay(offer.fromDate)}.`,
        });
        focusTask(offer.taskId);
        return;
      }

      setNotice(null);
      setFailure(`It could not be moved back. ${result.message}`);
      if (result.code === 'version_conflict') router.refresh();
    });
  }, [focusTask, notice, relocateOptimistically, router, undoing]);

  function carriesOurs(event: DragEvent) {
    return dragged.current !== null && Array.from(event.dataTransfer.types).includes(DRAG_TYPE);
  }

  function endDrag() {
    dragged.current = null;
    enterDepth.current = 0;
    setDraggingTaskId(null);
    setOverDate(null);
  }

  function startDrag(event: DragEvent<HTMLAnchorElement>, item: PlanCalendarItem, date: string) {
    if (!item.move || busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, item.taskId);
    dragged.current = { item, fromDate: date };
    enterDepth.current = 0;
    setFailure(null);
    /*
     * A frame later, not now. The browser photographs the item for the drag
     * image as soon as this handler returns, and dimming it first would make
     * the thing under the pointer look disabled.
     */
    requestAnimationFrame(() => setDraggingTaskId(item.taskId));
  }

  function dragOverDay(event: DragEvent<HTMLDivElement>, date: string) {
    const source = dragged.current;
    if (!source || !carriesOurs(event)) return;
    if (source.fromDate === date) {
      // Its own day is not a destination. Leaving the event alone is what
      // shows the "no drop" cursor there.
      setOverDate(null);
      return;
    }
    // Without this the browser refuses the drop before it reaches us.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOverDate((current) => (current === date ? current : date));
  }

  function dropOnDay(event: DragEvent<HTMLDivElement>, date: string) {
    const source = dragged.current;
    if (!source || !carriesOurs(event)) return;
    event.preventDefault();
    // Cleared here as well as on `dragend`: the move re-renders the item on
    // its new day, and a detached element's `dragend` never reaches React.
    endDrag();
    moveTo(source.item, source.fromDate, date);
  }

  function openMove(item: PlanCalendarItem, date: string) {
    setFailure(null);
    setMoveTarget({ item, fromDate: date });
    setMoveDate(date);
    setMoveOpen(true);
  }

  function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!moveTarget || !moveDate || moveDate === moveTarget.fromDate) return;
    setMoveOpen(false);
    moveTo(moveTarget.item, moveTarget.fromDate, moveDate);
  }

  function renderDay(day: PlanCalendarDay) {
    return (
      <div
        key={day.date}
        className={`day${day.isToday ? ' today' : ''}${day.items.length === 0 ? ' is-empty' : ''}${overDate === day.date ? ' is-drop-target' : ''}`}
        role="cell"
        data-date={day.date}
        onDragOver={(event) => dragOverDay(event, day.date)}
        onDrop={(event) => dropOnDay(event, day.date)}
      >
        <div className="daynum">
          {/* The grid shows a bare number; the agenda needs the full
              date, since it has no column headers to read from. */}
          <span aria-hidden="true">{day.dayNumber}</span>
          <span className="visually-hidden">{day.heading}</span>
          {day.isToday && <span className="visually-hidden"> (today)</span>}
        </div>

        {day.items.map((item) => (
          <div
            key={item.key}
            className={`cal-entry${draggingTaskId === item.taskId ? ' is-dragging' : ''}${item.saving ? ' is-saving' : ''}`}
          >
            <CalendarItem
              href={item.href}
              kind={item.kind}
              title={item.label}
              owner={item.owner}
              status={item.status}
              relation={item.relation}
              tooltip={item.tooltip}
              accessibleSuffix={item.accessibleSuffix}
              draggable={item.move !== undefined && !busy}
              onDragStart={(event) => startDrag(event, item, day.date)}
              onDragEnd={endDrag}
              taskAnchor={item.move ? item.taskId : undefined}
            />
            {item.move && (
              <button
                type="button"
                className="cal-item-move"
                aria-label={`Move due date: ${item.taskTitle}`}
                title="Move to another date"
                disabled={busy}
                onClick={() => openMove(item, day.date)}
              >
                <MoveIcon />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  const movingItem = moveTarget?.item;
  const movingTime =
    movingItem?.move && !movingItem.move.dueIsDateOnly ? movingItem.move.localTime : null;

  return (
    <>
      {/*
        A table, not a grid. `role="grid"` promises arrow-key movement between
        cells, which this calendar has never had: people Tab from item to item,
        and a table of days with links in its cells says exactly that.
      */}
      <div
        className="calendar"
        role="table"
        aria-label={`Commitments in ${monthLabel}`}
        tabIndex={-1}
        onDragEnter={(event) => {
          if (carriesOurs(event)) enterDepth.current += 1;
        }}
        onDragLeave={(event) => {
          if (!carriesOurs(event)) return;
          enterDepth.current = Math.max(0, enterDepth.current - 1);
          if (enterDepth.current === 0) setOverDate(null);
        }}
      >
        <div className="cal-row" role="row">
          {weekdays.map((day) => (
            <div key={day} className="cal-head" role="columnheader">
              {day}
            </div>
          ))}
        </div>

        {weeksOf(shown, leadingBlanks).map((week) => (
          <div key={week.find((slot) => slot !== null)?.date} className="cal-row" role="row">
            {week.map((slot, index) =>
              slot === null ? (
                /* Leading blanks keep the 1st under its correct weekday.
                   Hidden on mobile, where the grid becomes an agenda. */
                <div key={`blank-${index}`} className="day is-empty" aria-hidden="true" />
              ) : (
                renderDay(slot)
              ),
            )}
          </div>
        ))}
      </div>

      {moveTarget && movingItem && (
        <Modal open={moveOpen} title="Move due date" onClose={() => setMoveOpen(false)}>
          <form onSubmit={submitMove}>
            <div className="modal-head">
              <div>
                <strong>Move due date</strong>
                <span>{movingItem.taskTitle}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close move due date"
                onClick={() => setMoveOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body due-date-form">
              <div className="due-current-value">
                <span>Currently due</span>
                <strong>
                  {formatDay(moveTarget.fromDate)}
                  {movingTime ? `, ${movingTime}` : ''}
                </strong>
              </div>
              <div className="field">
                <label htmlFor="plan-move-date">New due date</label>
                <input
                  id="plan-move-date"
                  type="date"
                  // The same bound the drawer and New Work use, and the one the
                  // server enforces: a slipped digit in the year is a
                  // commitment that is never due and never late.
                  max={latestPlausibleDate()}
                  value={moveDate}
                  onChange={(event) => setMoveDate(event.target.value)}
                  required
                />
                {movingTime && <small>It keeps its time, {movingTime}.</small>}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setMoveOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busy || !moveDate || moveDate === moveTarget.fromDate}
                aria-busy={busy}
              >
                Move
              </button>
            </div>
          </form>
        </Modal>
      )}

      {failure ? (
        <div className="toast error" role="alert">
          <span>
            <strong>The date was not changed.</strong> {failure}
          </span>
          <button type="button" onClick={() => setFailure(null)}>
            Dismiss
          </button>
        </div>
      ) : (
        notice && (
          <Toast
            actionLabel={notice.undo ? (undoing ? 'Working…' : 'Undo') : undefined}
            onAction={notice.undo ? undo : undefined}
            actionDisabled={undoing}
            actionBusy={undoing}
            actionRef={undoButton}
          >
            {notice.text}
          </Toast>
        )
      )}
    </>
  );
}
