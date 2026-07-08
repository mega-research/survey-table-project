export interface SentryAlertSummary {
  title: string;
  errorType?: string;
  level?: string;
  project?: string;
  environment?: string;
  release?: string;
  culprit?: string;
  issueUrl?: string;
  issueId?: string;
  eventId?: string;
  alertRule?: string;
}

type UnknownRecord = Record<string, unknown>;

export function extractSentryAlertSummary(payload: unknown): SentryAlertSummary {
  const root = asRecord(payload);
  const data = asRecord(root['data']);
  const event = asRecord(data['event']);
  const metadata = firstRecord(event['metadata'], data['metadata'], root['metadata']);
  const firstException = firstExceptionValue(event);

  const errorType = pickString(metadata['type']);
  const errorValue =
    pickString(metadata['value']) ??
    pickString(firstException['value']) ??
    pickString(firstException['message']);
  const title =
    pickString(event['title']) ??
    pickString(data['title']) ??
    combineErrorTitle(errorType, errorValue) ??
    pickString(event['message']) ??
    pickString(data['message']) ??
    pickString(root['action']) ??
    'Sentry issue alert';
  const level = pickString(event['level']) ?? pickString(data['level']) ?? pickString(root['level']);
  const project =
    pickString(event['project_slug']) ??
    pickString(event['project_name']) ??
    pickString(event['project']) ??
    pickString(data['project']) ?? pickString(root['project']) ?? pickString(root['project_name']);
  const environment =
    pickString(event['environment']) ?? pickString(data['environment']) ?? pickString(root['environment']);
  const release = pickString(event['release']) ?? pickString(data['release']) ?? pickString(root['release']);
  const culprit = pickString(event['culprit']) ?? pickString(data['culprit']) ?? pickString(root['culprit']);
  const issueUrl =
    pickString(event['web_url']) ??
    pickString(event['permalink']) ??
    pickString(event['issue_url']) ??
    pickString(data['web_url']) ??
    pickString(data['permalink']) ??
    pickString(data['issue_url']) ??
    pickString(root['url']);
  const issueId = pickString(event['issue_id']) ?? pickString(data['issue_id']) ?? pickString(root['issue_id']);
  const eventId = pickString(event['event_id']) ?? pickString(data['event_id']) ?? pickString(root['event_id']);
  const issueAlert = asRecord(data['issue_alert']);
  const alertRule =
    pickString(data['triggered_rule']) ??
    pickString(issueAlert['title']) ??
    pickString(root['triggered_rule']);

  return {
    title,
    ...(errorType !== undefined ? { errorType } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(release !== undefined ? { release } : {}),
    ...(culprit !== undefined ? { culprit } : {}),
    ...(issueUrl !== undefined ? { issueUrl } : {}),
    ...(issueId !== undefined ? { issueId } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
    ...(alertRule !== undefined ? { alertRule } : {}),
  };
}

function firstRecord(...values: unknown[]): UnknownRecord {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
}

function firstExceptionValue(event: UnknownRecord): UnknownRecord {
  const exception = asRecord(event['exception']);
  const values = exception['values'];
  if (!Array.isArray(values)) {
    return {};
  }

  return asRecord(values[0]);
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
