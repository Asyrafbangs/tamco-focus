/**
 * The AI brief: what this product knows, written for somebody to paste.
 *
 * v317. The owner analyses their team's week in ChatGPT, and until now did it
 * by reading screens and retyping what they saw. This assembles the same
 * operational facts into one structured document: the open work, who owns it,
 * what is in the way, the last thing each person wrote, and the open ESH
 * findings. Nothing is sent anywhere - it is copied to the clipboard or saved
 * as a file, and where it goes next is the reader's business.
 *
 * Three rules shape every decision in here.
 *
 * **It never invents.** No hours, no effort band, no capacity figure, no
 * priority order of its own. TAMCO Focus records none of those, and a brief
 * that supplied them would be handing a language model fabricated inputs and
 * calling them records.
 *
 * **It never truncates silently.** Every count is given as "N of M". A source
 * that could not be read is named in the document, because a brief that
 * quietly omits the register reads exactly like a team with no findings.
 *
 * **It takes the product's own confidentiality rule.** A finding marked
 * restricted is "excluded from leadership reports and their counts" - the
 * product's words, on the form where the flag is set. A brief prepared for a
 * manager to analyse is such a report, so restricted findings are dropped
 * from the body AND from every count, and only the fact that some were
 * dropped is stated.
 */

/** Where one section's records came from, and whether they all arrived. */
export interface SourceCoverage {
  source: string;
  /** What reached this brief. */
  included: number;
  /**
   * What the source actually held — a counted total, never the number of rows
   * that happened to come back. Left undefined when it is genuinely unknown,
   * which is itself reported rather than papered over with `included`.
   */
  available?: number;
  /** Null when the read succeeded; the reason otherwise. */
  failure?: string | null;
  /**
   * v317 — what is missing, in the source's own words, when it knows better
   * than the arithmetic does. A walk that ran out of pages has no shortfall
   * `available - included` can express: the total itself is unverified.
   */
  shortfall?: string | null;
  note?: string;
}

/**
 * Whether a source is whole, and what to say when it is not.
 *
 * Exported because the test suite asserts on it directly: "complete" is a
 * claim about records somebody will act on, and the original version of this
 * function printed it whenever no read had thrown - including when it had
 * returned the first page of nine.
 */
export function coverageStatus(source: SourceCoverage): string {
  if (source.failure) return 'NOT READ';
  if (source.shortfall) return 'INCOMPLETE';
  if (source.available === undefined) return 'TOTAL NOT VERIFIED';
  if (source.included < source.available) return 'INCOMPLETE';
  return 'complete';
}

/** The missing portion as a sentence, or null when nothing is missing. */
export function coverageShortfall(source: SourceCoverage): string | null {
  if (source.failure) return null;
  if (source.shortfall) return source.shortfall;
  if (source.available === undefined) {
    return `${source.included} record(s) are here, but how many the source held was not counted.`;
  }
  if (source.included < source.available) {
    const missing = source.available - source.included;
    return `${missing} of ${source.available} not included.`;
  }
  return null;
}

export interface BriefChecklistAction {
  action: string;
  state: string;
  assignee?: string | null;
  dueAt?: string | null;
  evidenceRule?: string | null;
  blockedBy?: string | null;
}

export interface BriefUpdate {
  author: string;
  at: string;
  body: string;
}

export interface BriefTask {
  id: string;
  title: string;
  description?: string | null;
  owner: string;
  status: string;
  workClass?: string | null;
  urgency?: string | null;
  mandatory?: boolean;
  dueAt?: string | null;
  isOverdue?: boolean;
  isStale?: boolean;
  progressPercent?: number;
  checklistCompleted?: number;
  checklistTotal?: number;
  openBarrierCount?: number;
  delegatedOpenCount?: number;
  delegatedOverdueCount?: number;
  evidenceRule?: string | null;
  reviewStatus?: string | null;
  assignedBy?: string | null;
  link?: string | null;
  actions?: BriefChecklistAction[];
  latestUpdate?: BriefUpdate | null;
}

export interface BriefFinding {
  id: string;
  reference: string;
  title: string;
  riskLevel: string;
  status: string;
  actionState?: string | null;
  actionTitle?: string | null;
  owner?: string | null;
  dueAt?: string | null;
  isOverdue?: boolean;
  department?: string | null;
  hazard?: string | null;
  /** True when nothing verified is standing between people and the hazard. */
  noVerifiedInterimControl?: boolean;
  link?: string | null;
}

export interface AiBriefSnapshot {
  takenAt: string;
  timezone: string;
  preparedFor: string;
  /** How the viewer sees the team: what the product already decided. */
  viewerRole: string;
  teamTasks: BriefTask[];
  myTasks: BriefTask[];
  findings: BriefFinding[];
  coverage: SourceCoverage[];
  /** Restricted findings dropped by the product's own rule. */
  restrictedFindingsExcluded: number;
  /** True when this account cannot see the ESH register at all. */
  eshUnavailable?: string | null;
}

/**
 * Identifiers taken out of free text.
 *
 * Descriptions and updates are written by people, and people put things in
 * them: a mobile number, somebody's personal email, an identity card number
 * for a contractor's gate pass. None of that is needed to analyse a week's
 * work, and all of it would leave the building with the brief. The patterns
 * are narrow and the count is always reported, so a reader can see that
 * something was removed rather than wondering why a sentence reads oddly.
 *
 * This is a reduction of risk and not a guarantee: free text can hold things
 * no pattern will catch, which is why the brief says so in as many words.
 */
const IDENTIFIER_PATTERNS: Array<{ what: string; pattern: RegExp }> = [
  { what: 'email', pattern: /\b[\w.%+-]+@[\w-]+\.[\w.]{2,}\b/g },
  /* Malaysian NRIC: 6 digits of birth date, 2 of birthplace, 4 serial. */
  { what: 'identity number', pattern: /\b\d{6}-\d{2}-\d{4}\b/g },
  /* Malaysian mobile and landline forms, with or without the country code. */
  { what: 'phone number', pattern: /(?:\+?60|\b0)1\d[-\s]?\d{3,4}[-\s]?\d{4}\b/g },
  { what: 'bank or long account number', pattern: /\b\d{10,}\b/g },
];

export interface Redaction {
  text: string;
  removed: number;
}

export function redactIdentifiers(input: string | null | undefined): Redaction {
  const text = (input ?? '').trim();
  if (!text) return { text: '', removed: 0 };

  let removed = 0;
  let out = text;
  for (const { what, pattern } of IDENTIFIER_PATTERNS) {
    out = out.replace(pattern, () => {
      removed += 1;
      return `[${what} removed]`;
    });
  }
  return { text: out, removed };
}

/**
 * The snapshot instant, in the reader's own zone.
 *
 * `Intl` carries the zone database, so no table of offsets lives here and
 * daylight saving is somebody else's problem. A zone the runtime rejects
 * falls back to the instant as given rather than throwing: a brief is worth
 * having with an awkward timestamp, and worth nothing as an error page.
 */
function localTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Markdown-safe for a table cell: the pipe is the only structural character. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ');
}

/** A quoted line of somebody's own words, kept on one line. */
function quoted(value: string): string {
  return value.replace(/\r?\n+/g, ' ⏎ ').trim();
}

function yesNo(value: boolean | undefined): string {
  return value ? 'yes' : 'no';
}

function present(value: string | null | undefined, fallback = 'not recorded'): string {
  const text = (value ?? '').toString().trim();
  return text === '' ? fallback : text;
}

let redactionCount = 0;
function redacted(value: string | null | undefined): string {
  const { text, removed } = redactIdentifiers(value);
  redactionCount += removed;
  return text;
}

function taskSection(task: BriefTask, at: number): string[] {
  const lines: string[] = [];
  lines.push(`#### ${at}. ${task.title}`);
  lines.push('');
  lines.push(`- Record: \`${task.id}\`${task.link ? ` · ${task.link}` : ''}`);
  lines.push(`- Owner: ${present(task.owner, 'unassigned')}`);

  const flags = [
    `status ${present(task.status)}`,
    task.workClass ? `class ${task.workClass}` : '',
    task.urgency ? `urgency ${task.urgency}` : '',
    task.mandatory ? 'mandatory' : '',
  ].filter(Boolean);
  lines.push(`- State: ${flags.join(' · ')}`);

  lines.push(
    `- Deadline: ${present(task.dueAt, 'none recorded')} · overdue ${yesNo(task.isOverdue)}` +
      (task.isStale ? ' · no recent update' : ''),
  );

  const progress = [
    `${task.progressPercent ?? 0}% reported by the owner`,
    `checklist ${task.checklistCompleted ?? 0}/${task.checklistTotal ?? 0}`,
    `evidence to close: ${present(task.evidenceRule, 'optional')}`,
    `review: ${present(task.reviewStatus, 'not required')}`,
  ];
  lines.push(`- Progress: ${progress.join(' · ')}`);

  const waiting = [
    `${task.openBarrierCount ?? 0} open barrier(s)`,
    `${task.delegatedOpenCount ?? 0} step(s) owed by somebody else` +
      ((task.delegatedOverdueCount ?? 0) > 0 ? ` (${task.delegatedOverdueCount} overdue)` : ''),
  ];
  lines.push(`- Dependencies: ${waiting.join(' · ')}`);

  if (task.assignedBy) lines.push(`- Assigned by: ${task.assignedBy}`);

  const description = redacted(task.description);
  if (description) {
    lines.push(`- Scope as written: ${quoted(description)}`);
  } else {
    lines.push('- Scope as written: nothing recorded');
  }

  if (task.actions && task.actions.length > 0) {
    lines.push(`- Open checklist actions (${task.actions.length}):`);
    for (const [index, action] of task.actions.entries()) {
      const detail = [
        action.state ? action.state : '',
        action.assignee ? `assigned to ${action.assignee}` : '',
        action.dueAt ? `due ${action.dueAt}` : '',
        action.evidenceRule && action.evidenceRule !== 'not_required'
          ? `evidence ${action.evidenceRule}`
          : '',
        action.blockedBy ? `waiting on: ${action.blockedBy}` : '',
      ].filter(Boolean);
      lines.push(
        `  ${index + 1}. ${quoted(redacted(action.action))}${detail.length ? ` — ${detail.join(', ')}` : ''}`,
      );
    }
  } else {
    lines.push('- Open checklist actions: none listed');
  }

  if (task.latestUpdate) {
    lines.push(
      `- Latest update — ${task.latestUpdate.author}, ${task.latestUpdate.at}: ` +
        `"${quoted(redacted(task.latestUpdate.body))}"`,
    );
  } else {
    lines.push('- Latest update: none written');
  }

  lines.push('');
  return lines;
}

/**
 * The brief itself.
 *
 * Deterministic: the same snapshot produces the same document, which is what
 * makes the formatting testable and what lets a reader diff two briefs taken
 * a week apart.
 */
export function buildAiBrief(snapshot: AiBriefSnapshot): string {
  redactionCount = 0;
  const body: string[] = [];

  body.push('# TAMCO Focus — AI brief');
  body.push('');
  /*
   * The local time first, because that is the one the reader recognises, and
   * the instant after it. The first draft printed the UTC instant and labelled
   * it with the viewer's zone, so the document said 06:32 Kuala Lumpur for a
   * brief taken at half past two in the afternoon.
   */
  body.push(
    `- Snapshot taken: ${localTime(snapshot.takenAt, snapshot.timezone)} ` +
      `(${snapshot.timezone}) · ${snapshot.takenAt} UTC`,
  );
  body.push(`- Prepared for: ${snapshot.preparedFor} — ${snapshot.viewerRole}`);
  body.push(
    '- Scope: only the people and records this account is permitted to see. Anything outside ' +
      'that permission is absent from this document and is not marked.',
  );
  body.push('');

  body.push('## How to read this');
  body.push('');
  body.push(
    '- **There are no hours in this product.** No effort estimate, no duration and no capacity ' +
      'figure is recorded anywhere, so none appears here. A short task list is not evidence of ' +
      'spare capacity: routine duties, shift cover and work done outside this system are not in ' +
      'these records at all.',
  );
  body.push(
    '- Progress percentages are what the owner reported about their own work, not a measurement.',
  );
  body.push(
    '- "Open" work is a task in backlog, active or paused. Completed and cancelled work is not here.',
  );
  body.push(
    '- Free text is quoted as people wrote it. Identifiers matching a known pattern have been ' +
      'removed, but free text can carry things no pattern catches — read it before passing it on.',
  );
  body.push(
    '- A deadline is the recorded due date. Nothing in this document proposes a date of its own.',
  );
  body.push('');

  /* Coverage before content, so a gap is read before conclusions are drawn. */
  body.push('## Source coverage');
  body.push('');
  body.push('| Source | Included | Available | Status |');
  body.push('|---|---|---|---|');
  for (const source of snapshot.coverage) {
    const available = source.available === undefined ? 'not counted' : String(source.available);
    const state = coverageStatus(source);
    const why = source.failure ?? coverageShortfall(source);
    const status = state === 'complete' ? 'complete' : `**${state}** — ${cell(why ?? '')}`;
    body.push(
      `| ${cell(source.source)} | ${source.included} | ${available} | ${status}` +
        `${source.note ? ` ${cell(source.note)}` : ''} |`,
    );
  }
  body.push('');
  body.push(
    '*Available* is a counted total from the source, not the number of rows that came back. ' +
      'Where it says *not counted*, the figure was not available and the row says so rather ' +
      'than repeating the included count as if it were the total.',
  );
  body.push('');

  const failures = snapshot.coverage.filter((one) => one.failure);
  if (failures.length > 0) {
    body.push('### Retrieval failures');
    body.push('');
    body.push(
      'These sources could not be read. Treat each as **unknown**, never as empty: a register ' +
        'that failed to load reads exactly like a team with no findings.',
    );
    body.push('');
    for (const source of failures) body.push(`- **${source.source}**: ${source.failure}`);
    body.push('');
  }

  /*
   * A short read is not a failure and is not nothing. It is the case the
   * export was most likely to get wrong - every row present, every count
   * plausible, and a ninth of the register absent - so it gets its own
   * heading rather than a quiet cell in a table.
   */
  const short = snapshot.coverage
    .filter((one) => !one.failure)
    .map((one) => ({ source: one.source, missing: coverageShortfall(one) }))
    .filter((one): one is { source: string; missing: string } => one.missing !== null);
  if (short.length > 0) {
    body.push('### Incomplete sources');
    body.push('');
    body.push(
      'These sources were read successfully but did not all fit. **Do not treat the sections ' +
        'below as the complete set for these sources**, and do not compute a total, a share or ' +
        'a ranking from them without allowing for what is named here.',
    );
    body.push('');
    for (const one of short) body.push(`- **${one.source}**: ${one.missing}`);
    body.push('');
  }

  body.push('## Team tasks');
  body.push('');
  if (snapshot.teamTasks.length === 0) {
    body.push(
      'No open team task is visible to this account. That is what the records say, not ' +
        'necessarily what the team is doing.',
    );
    body.push('');
  } else {
    for (const [index, task] of snapshot.teamTasks.entries()) {
      body.push(...taskSection(task, index + 1));
    }
  }

  body.push('## My own work');
  body.push('');
  if (snapshot.myTasks.length === 0) {
    body.push('No open work is recorded against this account.');
    body.push('');
  } else {
    for (const [index, task] of snapshot.myTasks.entries()) {
      body.push(...taskSection(task, index + 1));
    }
  }

  body.push('## Open ESH findings');
  body.push('');
  if (snapshot.eshUnavailable) {
    body.push(`Not included: ${snapshot.eshUnavailable}`);
    body.push('');
  } else if (snapshot.findings.length === 0) {
    body.push('No open finding is visible to this account.');
    body.push('');
  } else {
    body.push(
      '| Reference | Finding | Risk | Status | Owner | Due | Overdue | Immediate control |',
    );
    body.push('|---|---|---|---|---|---|---|---|');
    for (const finding of snapshot.findings) {
      body.push(
        `| ${cell(finding.reference)} | ${cell(redacted(finding.title))} | ${cell(finding.riskLevel)} ` +
          `| ${cell(present(finding.actionState ?? finding.status))} | ${cell(present(finding.owner, 'unassigned'))} ` +
          `| ${cell(present(finding.dueAt, 'none'))} | ${yesNo(finding.isOverdue)} ` +
          `| ${finding.noVerifiedInterimControl ? '**none verified**' : 'not flagged'} |`,
      );
    }
    body.push('');
    const unprotected = snapshot.findings.filter((one) => one.noVerifiedInterimControl);
    if (unprotected.length > 0) {
      body.push(
        `**${unprotected.length} significant finding(s) have no verified interim control**: ` +
          `${unprotected.map((one) => one.reference).join(', ')}. For these, confirming immediate ` +
          'protection — isolation, a lock-out, a barrier, a stand-down — comes before the ' +
          'corrective action, its evidence and its due date.',
      );
      body.push('');
    }
    for (const finding of snapshot.findings) {
      const detail = [
        finding.department ? `department ${finding.department}` : '',
        finding.hazard ? `hazard ${finding.hazard}` : '',
        finding.actionTitle ? `action: ${quoted(redacted(finding.actionTitle))}` : '',
        finding.link ?? '',
      ].filter(Boolean);
      if (detail.length > 0) {
        body.push(`- ${finding.reference} (\`${finding.id}\`) — ${detail.join(' · ')}`);
      }
    }
    body.push('');
  }

  body.push('## What is deliberately not in this brief');
  body.push('');
  body.push(
    '- Hours, effort bands, capacity or workload figures — the product records none, and ' +
      'inventing them would be feeding you fabricated inputs.',
  );
  body.push('- Attachments, photographs and their contents.');
  body.push('- Medical, personal or disciplinary detail, and the contents of personnel records.');
  if (snapshot.restrictedFindingsExcluded > 0) {
    body.push(
      `- ${snapshot.restrictedFindingsExcluded} restricted ESH finding(s), excluded from this ` +
        'document and from every count in it, under the rule stated on the finding form: ' +
        '"kept out of leadership reports and their counts".',
    );
  } else {
    body.push('- Restricted ESH findings. None were present in this snapshot.');
  }
  body.push(
    `- ${redactionCount} identifier(s) matched a known pattern in free text and were replaced in place.`,
  );
  body.push('');
  body.push(
    '_Generated by TAMCO Focus. Read-only: producing this brief changed no record, and no part ' +
      'of it was sent anywhere by the product._',
  );

  return `${body.join('\n')}\n`;
}

/** `tamco-ai-brief-2026-11-09-1432.md`, stable and sortable. */
export function aiBriefFilename(takenAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${takenAt.getFullYear()}-${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())}` +
    `-${pad(takenAt.getHours())}${pad(takenAt.getMinutes())}`;
  return `tamco-ai-brief-${stamp}.md`;
}
