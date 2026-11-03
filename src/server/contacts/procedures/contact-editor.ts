import { type Actor, isLinkActor } from '@/server/survey-access';

import {
  type ContactEditor,
  contactEditorOf,
  linkContactEditor,
} from '../domain/contact-target-edit';

/**
 * 요청 주체 → 「대상 정보 수정 현황」·회차 기록자의 편집자.
 *
 * scoped 베이스는 외주 실사 링크도 지나 `context.user` 가 없을 수 있다 — 링크면 「외주」
 * (`linkContactEditor`), 계정이면 세션의 id·이메일이다. 서비스가 auth 를 다시 읽지 않게
 * procedure 가 인증된 context 에서 한 번 만든다.
 */
export function contactEditorOfContext(context: {
  actor: Actor;
  user?: { id: string; email?: string | null } | null;
}): ContactEditor {
  if (isLinkActor(context.actor)) return linkContactEditor(context.actor.linkId);
  return contactEditorOf(context.user ?? { id: context.actor.id });
}
