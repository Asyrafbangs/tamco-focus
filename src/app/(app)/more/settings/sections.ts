/*
 * The settings sections, as data.
 *
 * This lives apart from `SettingsWorkspace` because that file is a client
 * component, and `page.tsx` is a server component that iterates these to build
 * one panel per section. Importing a plain value out of a `use client` module
 * from the server does not give you the value: it gives you a client reference
 * proxy, so `SETTINGS_SECTIONS.filter` threw `is not a function` at request
 * time and the settings page rendered no panels at all. Types cannot catch
 * that — the array is correctly typed on both sides of the boundary.
 */

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

export interface SettingsItem {
  key: SettingsKey;
  label: string;
  description: string;
  group: 'Personal' | 'Organisation' | 'Records';
  editable: boolean;
}

export const SETTINGS_SECTIONS: SettingsItem[] = [
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
    description: 'Attention window, reminders and barrier escalation',
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
