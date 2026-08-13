import { sendLocalSmtp } from './smtp';
import { sendSmtp, smtpConfigFromEnv } from './smtp-transport';

/**
 * Which transport this environment sends through, decided in one place.
 *
 * The previous arrangement was a ternary in the runner:
 *
 *     transport: process.env.EMAIL_TRANSPORT === 'inbucket' ? 'inbucket' : 'log'
 *
 * which quietly made every value that was not the literal string `inbucket`
 * mean "write it to stdout and report success". Setting `EMAIL_TRANSPORT=smtp`,
 * or `brevo`, or misspelling `inbucket`, all produced a run that looked
 * completely healthy and delivered nothing. For a weekly summary — something
 * whose absence nobody chases — that could have gone unnoticed indefinitely.
 *
 * Now an unrecognised value is an error rather than a silent downgrade, and
 * `smtp` without credentials refuses to start rather than falling back.
 */
export type EmailTransportName = 'log' | 'inbucket' | 'smtp';

export interface ResolvedTransport {
  name: EmailTransportName;
  send?: (delivery: { to: string; subject: string; html: string; text: string }) => Promise<void>;
  /** What this environment will do, for the run log. */
  description: string;
}

export function resolveEmailTransport(
  env: Record<string, string | undefined> = process.env,
): ResolvedTransport | { error: string } {
  const requested = (env.EMAIL_TRANSPORT ?? 'log').trim().toLowerCase();

  if (requested === 'log') {
    return {
      name: 'log',
      description: 'log — messages are recorded as delivered but not sent anywhere',
    };
  }

  if (requested === 'inbucket') {
    const host = env.EMAIL_SMTP_HOST ?? '127.0.0.1';
    const port = Number(env.EMAIL_SMTP_PORT ?? 54325);
    const from = env.EMAIL_FROM ?? 'focus@tamco.local';
    return {
      name: 'inbucket',
      description: `inbucket — local capture at ${host}:${port}`,
      send: (delivery) => sendLocalSmtp({ ...delivery, from }, { host, port }),
    };
  }

  if (requested === 'smtp') {
    const config = smtpConfigFromEnv(env);
    if (config === null) {
      return {
        error:
          'EMAIL_TRANSPORT=smtp but EMAIL_SMTP_HOST is not set. Refusing to fall back to the log transport, which would discard mail while reporting success.',
      };
    }
    if ('error' in config) return config;

    return {
      name: 'smtp',
      description: `smtp — ${config.host}:${config.port} as ${config.from}`,
      send: async (delivery) => {
        await sendSmtp(config, delivery);
      },
    };
  }

  return {
    error: `EMAIL_TRANSPORT="${requested}" is not a transport. Use log, inbucket or smtp. It used to fall through to log, which sends nothing and reports success.`,
  };
}
