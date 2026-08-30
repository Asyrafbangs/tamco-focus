'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

export type SettingsKey =
  | 'workspace'
  | 'alerts'
  | 'accessibility'
  | 'appearance'
  | 'focus'
  | 'review'
  | 'routine'
  | 'reminders'
  | 'retention'
  | 'delivery'
  | 'security';

interface SettingsItem {
  key: SettingsKey;
  label: string;
  description: string;
  group: 'Personal' | 'Organisation' | 'Records';
  editable: boolean;
}

const ITEMS: SettingsItem[] = [
  {
    key: 'workspace',
    label: 'My workspace',
    description: 'Opening page, daily brief, week and quiet hours',
    group: 'Personal',
    editable: true,
  },
  {
    key: 'alerts',
    label: 'Email summaries',
    description: 'Personal notifications and weekly delivery',
    group: 'Personal',
    editable: true,
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    description: 'Theme, text size, motion and status labels',
    group: 'Personal',
    editable: true,
  },
  {
    key: 'appearance',
    label: 'Appearance',
    description: 'The colours the application is drawn in',
    group: 'Personal',
    editable: true,
  },
  {
    key: 'focus',
    label: 'Focus targets',
    description: 'Selection, capacity and stale-update rules',
    group: 'Organisation',
    editable: true,
  },
  {
    key: 'review',
    label: 'Completion review',
    description: 'Review timing and request-changes outcomes',
    group: 'Organisation',
    editable: true,
  },
  {
    key: 'routine',
    label: 'Routine work',
    description: 'Occurrence lead time and archive behaviour',
    group: 'Organisation',
    editable: true,
  },
  {
    key: 'reminders',
    label: 'Alerts & escalation',
    description: 'Today window, reminders and barrier escalation',
    group: 'Organisation',
    editable: true,
  },
  {
    key: 'retention',
    label: 'Access & records',
    description: 'Retention and authorised record access',
    group: 'Organisation',
    editable: true,
  },
  {
    key: 'delivery',
    label: 'Delivery history',
    description: 'Recent notification and weekly email outcomes',
    group: 'Records',
    editable: false,
  },
  {
    key: 'security',
    label: 'Security and records',
    description: 'Role capabilities and immutable history',
    group: 'Records',
    editable: false,
  },
];

export function SettingsNavigation({
  items,
  active,
  query,
  onQueryChange,
  onSelect,
}: {
  items: SettingsItem[];
  active: SettingsKey;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (key: SettingsKey) => void;
}) {
  const groups = ['Personal', 'Organisation', 'Records'] as const;
  return (
    <aside className="settings-master" aria-label="Settings navigation">
      <div className="settings-master-head">
        <strong>Settings</strong>
        <label className="settings-search">
          <span className="visually-hidden">Find a setting</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find a setting"
          />
        </label>
      </div>
      <nav className="settings-menu">
        {groups.map((group) => {
          const groupedItems = items.filter((item) => item.group === group);
          if (groupedItems.length === 0) return null;
          return (
            <div className="settings-menu-group" key={group}>
              <span className="settings-menu-label">{group}</span>
              {groupedItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`settings-nav-row${active === item.key ? ' active' : ''}`}
                  aria-current={active === item.key ? 'page' : undefined}
                  onClick={() => onSelect(item.key)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function SettingsWorkspace({
  canManageOperations,
  context,
  initialSection = 'workspace',
  children,
}: {
  canManageOperations: boolean;
  context: string;
  initialSection?: SettingsKey;
  children: ReactNode;
}) {
  const available = ITEMS.filter((item) => canManageOperations || item.group !== 'Organisation');
  const [active, setActive] = useState<SettingsKey>(
    available.some((item) => item.key === initialSection) ? initialSection : 'workspace',
  );
  const [query, setQuery] = useState('');
  const [dirtyPanels, setDirtyPanels] = useState<Set<SettingsKey>>(() => new Set());
  const detailRef = useRef<HTMLDivElement>(null);
  const current = available.find((item) => item.key === active) ?? available[0]!;
  const dirty = dirtyPanels.has(active);
  const filtered = available.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function submitActiveForms() {
    const panel = detailRef.current?.querySelector<HTMLElement>(
      `[data-settings-panel="${active}"]`,
    );
    panel?.querySelectorAll<HTMLFormElement>('form').forEach((form) => form.requestSubmit());
    setDirtyPanels((previous) => {
      const next = new Set(previous);
      next.delete(active);
      return next;
    });
  }

  function discardActiveForms() {
    const panel = detailRef.current?.querySelector<HTMLElement>(
      `[data-settings-panel="${active}"]`,
    );
    panel?.querySelectorAll<HTMLFormElement>('form').forEach((form) => form.reset());
    setDirtyPanels((previous) => {
      const next = new Set(previous);
      next.delete(active);
      return next;
    });
  }

  return (
    <div className="settings-workspace" data-active={active}>
      <div className="settings-pagehead">
        <div>
          <Link href="/more" className="btn ghost small">
            ← More
          </Link>
          <p className="eyebrow">Settings</p>
          <h1>Team rules and my preferences</h1>
          <p>
            Configure only settings that change how work is selected, reviewed, escalated or
            displayed.
          </p>
        </div>
        <div className="settings-savebar">
          {dirtyPanels.size > 0 && (
            <span className="unsaved-indicator" role="status">
              {dirtyPanels.size} unsaved {dirtyPanels.size === 1 ? 'section' : 'sections'}
            </span>
          )}
          <button type="button" className="btn" onClick={discardActiveForms} disabled={!dirty}>
            Discard
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submitActiveForms}
            disabled={!dirty || !current.editable}
          >
            Save changes
          </button>
        </div>
      </div>

      <div className="settings-shell">
        <SettingsNavigation
          items={filtered}
          active={active}
          query={query}
          onQueryChange={setQuery}
          onSelect={setActive}
        />

        <section className="settings-detail" aria-labelledby="settings-detail-title">
          <header className="settings-detail-head">
            <div>
              <p className="eyebrow">{current.group}</p>
              <h2 id="settings-detail-title">{current.label}</h2>
              <p>{current.description}</p>
            </div>
          </header>
          <div className="settings-summary">
            <span>Context</span>
            <strong>{context}</strong>
          </div>
          <div
            ref={detailRef}
            className="settings-body"
            onChange={() => setDirtyPanels((previous) => new Set(previous).add(active))}
            onInput={() => setDirtyPanels((previous) => new Set(previous).add(active))}
          >
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
