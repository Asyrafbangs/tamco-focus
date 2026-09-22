export type ReportState = 'draft' | 'active' | 'paused';
export type ReportSignal = 'open' | 'overdue' | 'awaiting_verification' | 'closed';

export interface ReportDefinitionSummary {
  id: string;
  name: string;
  state: ReportState;
  timezone: string;
  scheduleIsoDay: number;
  scheduleLocalTime: string;
  organizationWide: boolean;
  includeDescendants: boolean;
  version: number;
  scopeVersion: number;
  departmentIds: string[];
  recipients: Array<{ email: string; enabled: boolean }>;
  latestRun: null | {
    id: string;
    capturedAt: string;
    open: number;
    overdue: number;
    awaiting: number;
    closed: number;
  };
}

export interface GuestReportRow {
  signal: ReportSignal;
  departmentName: string | null;
  reference: string;
  findingTitle: string;
  location: string | null;
  ownerEmail: string | null;
  actionTitle: string | null;
  actionState: string | null;
  dueAt: string | null;
  dueIsDateOnly: boolean | null;
  lastUpdateAt: string | null;
  closedAt: string | null;
}

export interface GuestReport {
  mode: 'snapshot' | 'live';
  name: string;
  capturedAt: string;
  timezone: string;
  closedWindowStart: string;
  closedWindowEnd: string;
  counts: { open: number; overdue: number; awaiting: number; closed: number };
  rows: GuestReportRow[];
}
