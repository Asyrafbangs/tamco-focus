/**
 * Stage 2 starts closed. Opening public reporting is a separate operational
 * decision because the approved emergency route, privacy notice, retention
 * and upload/scanner policy are not configuration details a UI may guess.
 */
export const publicQrIntakeEnabled = false;

export const publicQrIntakeUnavailable = {
  title: 'Safety reporting is not available from this link',
  detail: 'This link does not submit a report or notify anyone.',
  immediateDanger:
    'For immediate danger, follow your site’s established emergency procedure.',
} as const;
