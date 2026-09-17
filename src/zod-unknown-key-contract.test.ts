import { describe, expect, it } from 'vitest';
import * as z from 'zod';

/**
 * zod 가 unknown 키를 어떻게 다루는가 — **레포 전체 mass assignment 판정의 전제.**
 *
 * `updateSurvey` 가 payload 를 drizzle `.set()` 에 펼쳐 ownerUserId 주입 승격이 가능했던 사고
 * (Codex 적대적 리뷰, 2026-08-27) 뒤에 입력 스키마를 전수 감사했다. 결론은 "입력이 `z.object`
 * 면 unknown 키가 strip 되어 구조적으로 안전하고, 뚫린 것은 `z.custom` 하나뿐" 이었다.
 *
 * 그 결론이 zod 의 기본 동작에 통째로 기대고 있으므로 여기서 실측으로 못 박는다 — zod 메이저
 * 업그레이드가 기본값을 loose 로 바꾸면 감사 결과 전체가 조용히 무효가 된다.
 */
describe('zod unknown-key 처리 실측', () => {
  it('z.object 는 unknown 키를 strip 한다', () => {
    const s = z.object({ title: z.string().optional() });
    const out = s.parse({ title: 'ok', ownerUserId: 'attacker' });
    expect(out).toEqual({ title: 'ok' });
    expect('ownerUserId' in out).toBe(false);
  });

  it('.partial() 도 strip 한다', () => {
    const s = z.object({ name: z.string(), color: z.string() }).partial();
    const out = s.parse({ name: 'x', isPreset: true });
    expect(out).toEqual({ name: 'x' });
  });

  it('중첩 z.object 도 strip 한다 — { id, updates: {...} } 패턴', () => {
    const s = z.object({ id: z.string(), updates: z.object({ name: z.string() }).partial() });
    const out = s.parse({ id: 'a', updates: { name: 'n', isPreset: true } });
    expect(out.updates).toEqual({ name: 'n' });
  });

  it('z.custom 은 아무것도 보지 않는다 — 이번 사고의 원인', () => {
    const s = z.custom<{ title?: string }>();
    const out = s.parse({ ownerUserId: 'attacker', deletedAt: new Date() }) as Record<string, unknown>;
    expect(out['ownerUserId']).toBe('attacker');
  });

  it('.strict() 는 버리지 않고 던진다 — UpdateSurveyDataSchema 가 고른 쪽', () => {
    const s = z.object({ title: z.string().optional() }).strict();
    expect(() => s.parse({ title: 'ok', ownerUserId: 'attacker' })).toThrow();
  });
});
