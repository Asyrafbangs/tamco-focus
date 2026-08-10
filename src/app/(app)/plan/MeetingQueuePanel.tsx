'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import type { OperationResult } from '@/domain/types';
import { removeMeetingQueueItem, scheduleMeetingQueueItem } from '@/server/actions/task-actions';
import type { MeetingQueueRow } from '@/server/queries';

function idempotencyKey() {
  return crypto.randomUUID();
}

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

/**
 * The Meeting Queue, inside Monthly Plan (v47 sections 15-17).
 *
 * Deliberately a drawer on the page that already owns planning, not a module
 * in the sidebar. Most weeks it holds nothing; a permanent destination for an
 * occasionally-empty list teaches people to stop looking at it.
 *
 * It stays small on purpose. Its job is to answer "what still needs talking
 * about, and when" — scheduling, opening the underlying request, or dropping a
 * topic. It is not a meeting manager, and there are no agendas, minutes or
 * attendee workflows here.
 */
export function MeetingQueuePanel({
  items,
  people,
  timeZone,
}: {
  items: MeetingQueueRow[];
  /** Colleagues who can be added to a discussion. */
  people: Array<{ id: string; name: string }>;
  timeZone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduling, setScheduling] = useState<MeetingQueueRow | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(30);
  const [extraParticipants, setExtraParticipants] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const activeCount = items.length;

  function finish(result: OperationResult, success: string) {
    if (result.ok) {
      setMessage({ tone: 'success', text: success });
      router.refresh();
      return true;
    }
    setMessage({ tone: 'error', text: result.message });
    return false;
  }

  function closeScheduling() {
    setScheduling(null);
    setStartsAt('');
    setDuration(30);
    setExtraParticipants([]);
  }

  return (
    <>
      <button
        type="button"
        className="btn small meeting-queue-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Meeting Queue
        {activeCount > 0 && <span className="meeting-queue-count">{activeCount}</span>}
      </button>

      <Modal open={open} title="Meeting Queue" onClose={() => setOpen(false)}>
        <header className="modalhead">
          <div>
            <h2>Meeting Queue</h2>
            <p>Topics waiting to be discussed, and the discussions already booked.</p>
          </div>
        </header>

        <div className="modalbody meeting-queue-body">
          {message && (
            <p className={`form-message ${message.tone}`} role="status">
              {message.text}
            </p>
          )}

          {items.length === 0 ? (
            <p className="muted">
              Nothing is waiting to be discussed. Topics arrive here when somebody adds a request to
              the Meeting Queue instead of answering it straight away.
            </p>
          ) : (
            <ul className="meeting-queue-list">
              {items.map((item) => (
                <li key={item.id} className="meeting-queue-row">
                  <div className="meeting-queue-copy">
                    <strong>{item.summary}</strong>
                    {item.taskTitle && <span>From: {item.taskTitle}</span>}
                    {item.requestedByName && <span>Requested by: {item.requestedByName}</span>}
                    {item.addedByName && <span>Added by: {item.addedByName}</span>}
                    {item.scheduledAt && (
                      <span className="meeting-queue-scheduled">
                        📅 Scheduled {formatMoment(item.scheduledAt, timeZone)}
                      </span>
                    )}
                  </div>

                  <div className="meeting-queue-actions">
                    {/*
                      §65 — every control here does something or is not here.
                      A topic already booked offers no second Schedule, and one
                      in somebody's diary cannot be quietly dropped.
                    */}
                    {!item.scheduledAt && (
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => {
                          setMessage(null);
                          setScheduling(item);
                        }}
                      >
                        Schedule
                      </button>
                    )}

                    {item.href && (
                      <Link href={item.href} className="btn small" onClick={() => setOpen(false)}>
                        Open request
                      </Link>
                    )}

                    {!item.scheduledAt && (
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={pending}
                        aria-busy={pending}
                        onClick={() => {
                          setMessage(null);
                          startTransition(async () => {
                            finish(
                              await removeMeetingQueueItem({
                                itemId: item.id,
                                idempotencyKey: idempotencyKey(),
                              }),
                              'Removed from the Meeting Queue.',
                            );
                          });
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {scheduling && (
        <Modal open title="Schedule discussion" onClose={closeScheduling}>
          <header className="modalhead">
            <div>
              <h2>Schedule discussion</h2>
              <p>This goes on the Monthly Plan. It does not answer the request.</p>
            </div>
          </header>

          <form
            className="modalbody detail-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!startsAt) return;
              const item = scheduling;
              startTransition(async () => {
                const result = await scheduleMeetingQueueItem({
                  itemId: item.id,
                  startsAt,
                  durationMinutes: duration,
                  participantIds: extraParticipants,
                  idempotencyKey: idempotencyKey(),
                });
                if (
                  finish(
                    result,
                    result.code === 'discussion_already_scheduled'
                      ? 'Somebody had already scheduled this. Showing their booking.'
                      : 'Discussion scheduled.',
                  )
                ) {
                  closeScheduling();
                }
              });
            }}
          >
            {/*
              §22 — the topic, the work and the people come from the request.
              Retyping what the barrier already says is how a discussion ends up
              titled "catch up" with nobody able to tell what it was about.
            */}
            <div className="field full">
              <label htmlFor="schedule-topic">Topic</label>
              <input id="schedule-topic" value={scheduling.summary} readOnly />
              {scheduling.taskTitle && <small>From: {scheduling.taskTitle}</small>}
            </div>

            <div className="field">
              <label htmlFor="schedule-when">Date and time</label>
              <input
                id="schedule-when"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="schedule-duration">Length</label>
              <select
                id="schedule-duration"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>

            <div className="field full">
              <label htmlFor="schedule-participants">Also invite</label>
              <select
                id="schedule-participants"
                multiple
                size={4}
                value={extraParticipants}
                onChange={(event) =>
                  setExtraParticipants(
                    Array.from(event.target.selectedOptions).map((option) => option.value),
                  )
                }
              >
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <small>
                {scheduling.requestedByName
                  ? `${scheduling.requestedByName} and you are already included.`
                  : 'You are already included.'}
              </small>
            </div>

            <footer className="modalfoot">
              <button type="button" className="btn" onClick={closeScheduling}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || !startsAt}
                aria-busy={pending}
              >
                Add to calendar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
