import { publicQrIntakeEnabled, publicQrIntakeUnavailable } from '@/domain/esh-qr-intake';

/**
 * A deliberately closed public endpoint. It must not become a submit route
 * until Stage 2's independent privacy and emergency-routing gates are met.
 */
export default function PublicReportPage() {
  if (publicQrIntakeEnabled) {
    // The enabled submission flow is intentionally not implemented yet.
    // Keeping this branch explicit prevents an environment toggle from
    // accidentally turning a placeholder into a public reporting service.
    return null;
  }

  return (
    <main>
      <h1>{publicQrIntakeUnavailable.title}</h1>
      <p>{publicQrIntakeUnavailable.detail}</p>
      <p>{publicQrIntakeUnavailable.immediateDanger}</p>
    </main>
  );
}
