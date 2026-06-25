export interface SentryAlertSummary {
  title: string;
  errorType?: string;
  level?: string;
  project?: string;
  environment?: string;
  release?: string;
  issueUrl?: string;
  issueId?: string;
}

type UnknownRecord = Record<string, unknown>;

export function extractSentryAlertSummary(payload: unknown): SentryAlertSummary {
  const root = asRecord(payload);
  const data = asRecord(root['data']);
  const metadata = asRecord(data['metadata']);

  const errorType = pickString(metadata['type']);
  const errorValue = pickString(metadata['value']);
  const title =
    pickString(data['title']) ??
    combineErrorTitle(errorType, errorValue) ??
    pickString(data['message']) ??
    pickString(root['action']) ??
    'Sentry issue alert';

  return omitUndefined({
    title,
    errorType,
    level: pickString(data['level']) ?? pickString(root['level']),
    project:
      pickString(data['project']) ?? pickString(root['project']) ?? pickString(root['project_name']),
    environment: pickString(data['environment']) ?? pickString(root['environment']),
    release: pickString(data['release']) ?? pickString(root['release']),
    issueUrl:
      pickString(data['web_url']) ??
      pickString(data['permalink']) ??
      pickString(data['issue_url']) ??
      pickString(root['url']),
    issueId: pickString(data['issue_id']) ?? pickString(root['issue_id']),
  });
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function combineErrorTitle(type: string | undefined, value: string | undefined): string | undefined {
  if (type && value) {
    return `${type}: ${value}`;
  }

  return value ?? type;
}

function omitUndefined(summary: SentryAlertSummary): SentryAlertSummary {
  const entries = Object.entries(summary).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as SentryAlertSummary;
}
