'use client';

import Link from 'next/link';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';

import { RevealCurrent } from '@/components/ui/RevealCurrent';
import { SETTINGS_SECTIONS, type SettingsItem, type SettingsKey } from './sections';

export type { SettingsKey };

/**
 * Which section is open, for the panels the page passes in as children.
 *
 * The panels used to be revealed by an enumerated list of
 * `[data-active='x'] [data-settings-panel='x']` rules in the stylesheet, one
 * line per section. A section added without its line was `display: none` for
 * good — present in the DOM, navigable, and invisible — and nothing but a
 * browser test could see it. The open section is state this component already
 * holds, so it is the thing that decides, and a new section cannot be left out
 * of a list that no longer exists.
 */
const OpenSection = createContext<SettingsKey>('workspace');

export function SettingsPanel({
  section,
  label,
  children,
}: {
  section: SettingsKey;
  label: string;
  children: ReactNode;
}) {
  const open = useContext(OpenSection);
  return (
    <section data-settings-panel={section} aria-label={label} hidden={open !== section}>
      {children}
    </section>
  );
}

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
      {/*
       * Brings the section you opened into view. On a phone this menu is a
       * horizontal scroller at 132px a row, and eleven sections are 1500px of
       * it in a 362px box, so opening Appearance, Delivery history or Security
       * left the row you had just chosen off to the right with the menu still
       * showing the first three (v243). The same island does the Goals people
       * column, which had the same fault (v250).
       */}
      <RevealCurrent within=".settings-menu" current='[aria-current="page"]' watch={active} />
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
                  {/*
                   * The description reads under the label, wrapping.
                   *
                   * It used to be clipped to one line, so eleven rows read
                   * "Opening page, daily b…", "Theme, text size, mo…" — half a
                   * sentence each, and removing it was the obvious answer. But
                   * it is also what tells somebody listening what a row
                   * contains: a row announcing only "Alerts & escalation" does
                   * not mention the attention window inside it. Carrying it as
                   * an `aria-label` instead made `getByLabel('Text size')`
                   * match this row as well as the control it belongs to; as a
                   * visually-hidden span it pushed the phone layout to 722px.
                   * Visible and wrapping is the form that costs nothing: a
                   * button's own text names it without becoming a label.
                   */}
                  <span className="settings-nav-row-label">{item.label}</span>
                  <span className="settings-nav-row-desc">{item.description}</span>
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
  const available = SETTINGS_SECTIONS.filter(
    (item) => canManageOperations || item.group !== 'Organisation',
  );
  /*
   * A link that names a real section opens that section, even when this
   * person may not change it.
   *
   * It used to fall back to "My workspace" without saying so, so an
   * administrator who sent "/more/settings?section=focus" to a team member
   * got back "that link just opens my own preferences". The section opens and
   * states who may change it instead; silently landing somewhere else is the
   * one outcome that teaches nobody anything. A key that names no section at
   * all is a mistyped address and still opens the default.
   */
  const [active, setActive] = useState<SettingsKey>(
    SETTINGS_SECTIONS.some((item) => item.key === initialSection) ? initialSection : 'workspace',
  );
  const [query, setQuery] = useState('');
  const [dirtyPanels, setDirtyPanels] = useState<Set<SettingsKey>>(() => new Set());
  const detailRef = useRef<HTMLDivElement>(null);
  const current = SETTINGS_SECTIONS.find((item) => item.key === active) ?? SETTINGS_SECTIONS[0]!;
  const outOfReach = !available.some((item) => item.key === active);
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
          <h1>Team rules and my preferences</h1>
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
            disabled={!dirty || !current.editable || outOfReach}
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
            {outOfReach && (
              <div className="empty-state compact">
                <p>
                  A manager or administrator sets {current.label.toLowerCase()} for the whole team.
                  Ask yours to change it. Your own settings are in the list beside this.
                </p>
              </div>
            )}
            <OpenSection value={active}>{children}</OpenSection>
          </div>
        </section>
      </div>
    </div>
  );
}
