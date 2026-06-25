import type { SentryAlertSummary } from './sentry';

interface JandiConnectInfo {
  title: string;
  description: string;
}

export interface JandiMessage {
  body: string;
  connectColor: string;
  connectInfo: JandiConnectInfo[];
}

export function buildJandiMessage(summary: SentryAlertSummary): JandiMessage {
  const connectInfo: JandiConnectInfo[] = [];

  addInfo(connectInfo, 'Project', summary.project);
  addInfo(connectInfo, 'Level', summary.level);
  addInfo(connectInfo, 'Environment', summary.environment);
  addInfo(connectInfo, 'Release', summary.release);
  addInfo(connectInfo, 'Issue ID', summary.issueId);

  if (summary.issueUrl) {
    addInfo(connectInfo, 'Issue', `[Open in Sentry](${summary.issueUrl})`);
  }

  return {
    body: `[Sentry] ${summary.title}`,
    connectColor: colorForLevel(summary.level),
    connectInfo,
  };
}

function addInfo(items: JandiConnectInfo[], title: string, description: string | undefined): void {
  if (description) {
    items.push({ title, description });
  }
}

function colorForLevel(level: string | undefined): string {
  switch (level?.toLowerCase()) {
    case 'fatal':
      return '#D92D20';
    case 'error':
      return '#E5484D';
    case 'warning':
      return '#F59E0B';
    case 'info':
    case 'debug':
      return '#3B82F6';
    default:
      return '#6B7280';
  }
}
