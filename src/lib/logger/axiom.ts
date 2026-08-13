import 'server-only';

import { Axiom, ContentEncoding } from '@axiomhq/js';

/**
 * Axiom 클라이언트 게이트. AXIOM_TOKEN + AXIOM_DATASET 둘 다 있어야 켜진다 —
 * 미설정이면 전 로깅 경로가 stdout 전용으로 동작한다 (현 운영 상태).
 *
 * worker transport(@axiomhq/pino)가 아니라 메인 스레드에서 ingest 를 큐잉하고
 * @axiomhq/js 가 내부 배칭한다. 서버리스 freeze 전에 flushAxiom() 을 호출해야
 * 배치가 실제 전송된다 — flush.ts 참조. (근거: .scratch/logging-pino/assets/01)
 *
 * 알려진 이슈 대응: @axiomhq/js 의 gzip(Auto) 인코딩 경로가 Node 24.16+ 의
 * CompressionStream 메모리 누수를 밟는다(axiomhq/axiom-js#471, nodejs/node#63574 —
 * 2026-08 현재 24.19.0 까지 미수정, Vercel 은 Node 메이저만 고정 가능해 런타임
 * 버전 회피 불가). 이슈의 공식 워크어라운드대로 인코딩을 Identity 로 강제해
 * gzip 경로 자체를 우회한다 — 아래 getAxiomOrNull 참조. Node fix 릴리스 후 제거.
 */

const token = process.env['AXIOM_TOKEN'];
const dataset = process.env['AXIOM_DATASET'];

let client: Axiom | null = null;

export function isAxiomEnabled(): boolean {
  return Boolean(token && dataset);
}

/** 활성화 상태에서만 클라이언트 반환 (lazy 싱글턴). 비활성이면 null. */
export function getAxiomOrNull(): { client: Axiom; dataset: string } | null {
  if (!token || !dataset) return null;
  if (!client) {
    client = new Axiom({
      token,
      // 전송 실패는 throw 하지 않고 stdout(Vercel 로그)에만 남긴다 — 로깅이 앱을 죽이면 안 됨.
      // 로거 자신의 장애라 pino 로 보내면 재귀 위험 — 최후 보루로 console 유지.
      // eslint-disable-next-line no-console
      onError: (err) => console.error('[axiom] ingest 실패', err),
    });
    // 배치 ingest 가 ContentEncoding.Auto 를 하드코딩하므로(클라이언트 옵션 부재)
    // ingestRaw 를 감싸 Identity 로 강제한다 — 상단 gzip 누수 주석 참조.
    const ingestRaw = client.ingestRaw;
    client.ingestRaw = (dataset, data, contentType, _encoding, options) =>
      ingestRaw(dataset, data, contentType, ContentEncoding.Identity, options);
  }
  return { client, dataset };
}

/** 배치 큐의 HTTP 전송 완료까지 대기. 비활성이면 no-op. */
export async function flushAxiom(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch (err) {
    // 상동 — 로거 자신의 장애는 console 이 최후 보루.
    // eslint-disable-next-line no-console
    console.error('[axiom] flush 실패', err);
  }
}
