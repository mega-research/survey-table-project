import 'server-only';

import { and, desc, gte, isNotNull, isNull, max, sql } from 'drizzle-orm';

import { db } from '@/db';
import { mailCampaigns, mailTemplates } from '@/db/schema/mail';

import { collectReplyAddresses } from '../domain/reply-forward';

/**
 * 회신 주소 조회 (DB 읽기 전용) — 회신 전달이 「어느 회신 주소로 넘길지」를 찾는 자리.
 *
 * 전달 주소는 여기서 읽은 값, 곧 우리 DB 에 적힌 회신 주소에서만 나온다. 받은 메일의 어떤 값도
 * 전달 주소가 되지 않는다(릴레이 악용 방지) — 새 조회를 더할 때도 이 성질을 지킬 것.
 */

/** 주소를 찾은 방법 — 그 계정의 발송 회차 회신 주소 / 그 계정을 쓰는 템플릿의 회신 주소. */
export type ReplyAddressSource = 'campaign' | 'template';

export interface AccountReplyAddresses {
  /** null = 쓴 적 없는 보낸이 계정(전달 주소 없음). */
  source: ReplyAddressSource | null;
  /** 전달 주소 후보 — 최근 것부터, 대소문자 무시 중복 없이, 발송 전용 도메인 주소 제외. */
  addresses: string[];
}

/** 계정 기준으로 볼 발송 회차의 기간. */
const ACCOUNT_LOOKBACK_YEARS = 1;
/** 서로 다른 회신 주소 값을 읽는 상한 — 한 통의 수신자 상한(50)보다 넉넉히 읽고 규칙이 자른다. */
const DISTINCT_REPLY_LIMIT = 200;

/**
 * 보낸이 계정 기준 전달 주소.
 *
 * 그 계정으로 최근 1년 안에 만든 발송 회차(단체·단건·대체 발송·테스트 회차, 보관된 회차, 실/테스트 파티션 전부)의
 * 회신 주소 스냅샷을 중복 없이 모은다. 하나도 없으면 그 계정을 쓰는 삭제되지 않은 템플릿의 회신 주소다
 * (캠페인 없이 「테스트 발송」만 한 템플릿의 답장). 회신 주소가 빈 회차와 발송 전용 도메인의 주소는 후보가 아니다.
 *
 * @param senderAccount 보낸이 계정 — 소문자로 넘길 것(대소문자 무시 비교).
 */
export async function loadAccountReplyAddresses(
  senderAccount: string,
  options: { sendDomain: string; now?: Date },
): Promise<AccountReplyAddresses> {
  const account = senderAccount.trim().toLowerCase();
  if (!account) return { source: null, addresses: [] };

  const since = new Date(options.now ?? new Date());
  since.setFullYear(since.getFullYear() - ACCOUNT_LOOKBACK_YEARS);

  const campaignLastAt = max(mailCampaigns.createdAt);
  const campaignRows = await db
    .select({ replyTo: mailCampaigns.replyToSnapshot })
    .from(mailCampaigns)
    .where(
      and(
        sql`lower(${mailCampaigns.fromLocalSnapshot}) = ${account}`,
        gte(mailCampaigns.createdAt, since),
        isNotNull(mailCampaigns.replyToSnapshot),
        sql`btrim(${mailCampaigns.replyToSnapshot}) <> ''`,
      ),
    )
    .groupBy(mailCampaigns.replyToSnapshot)
    .orderBy(desc(campaignLastAt))
    .limit(DISTINCT_REPLY_LIMIT);
  const fromCampaigns = collectReplyAddresses(
    campaignRows.map((row) => row.replyTo),
    options.sendDomain,
  );
  if (fromCampaigns.length > 0) return { source: 'campaign', addresses: fromCampaigns };

  const templateLastAt = max(mailTemplates.updatedAt);
  const templateRows = await db
    .select({ replyTo: mailTemplates.replyTo })
    .from(mailTemplates)
    .where(
      and(
        sql`lower(${mailTemplates.fromLocal}) = ${account}`,
        isNull(mailTemplates.deletedAt),
        isNotNull(mailTemplates.replyTo),
        sql`btrim(${mailTemplates.replyTo}) <> ''`,
      ),
    )
    .groupBy(mailTemplates.replyTo)
    .orderBy(desc(templateLastAt))
    .limit(DISTINCT_REPLY_LIMIT);
  const fromTemplates = collectReplyAddresses(
    templateRows.map((row) => row.replyTo),
    options.sendDomain,
  );
  if (fromTemplates.length > 0) return { source: 'template', addresses: fromTemplates };

  return { source: null, addresses: [] };
}
