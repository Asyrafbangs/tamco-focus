/**
 * What a QR code says when it does not report anything (v272, v288).
 *
 * v272 kept this as a hard-coded `publicQrIntakeEnabled = false`, because the
 * channel could not be opened at all: there was no submission procedure and
 * the settings table's own CHECK allowed only the closed value. v288 built the
 * path and moved the switch into the database, behind an administrator-only
 * procedure that demands a reason — so the constant is gone and the answer
 * comes from the switch.
 *
 * The words stay here. A sticker whose code has been retired, a code nobody
 * issued and a channel that is not open all reach the same screen on purpose:
 * telling somebody which of the three it is would be telling them about the
 * plant's own arrangements, and none of the three means their concern should
 * go unreported.
 */
export const publicQrIntakeUnavailable = {
  title: 'Safety reporting is not available from this link',
  detail: 'This link does not submit a report or notify anyone. Tell your supervisor instead.',
  immediateDanger: 'For immediate danger, follow your site’s established emergency procedure.',
} as const;

/** What a visitor without a code is told: the code is on the sticker. */
export const publicQrIntakeNoCode = {
  title: 'Scan the sticker to report',
  detail:
    'This page needs the code from the safety-reporting sticker in your area. Scanning the sticker with your phone’s camera opens the right page.',
} as const;
