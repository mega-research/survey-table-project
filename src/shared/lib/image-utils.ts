/**
 * 이미지 최적화 유틸리티 함수
 * 브라우저에서 이미지를 리사이징하고 압축합니다.
 */

import { client } from '@/shared/lib/rpc';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920;
const QUALITY = 0.85;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxFileSize?: number;
}

/**
 * 최적화 출력 MIME 타입을 결정한다.
 * 알파 채널을 가질 수 있는 PNG/WebP 는 WebP 로 출력해 투명도를 보존하면서 품질 압축도 적용한다.
 * 그 외(JPEG/BMP 등 알파 없는 형식)는 JPEG 로 출력한다.
 * (과거에는 PNG 를 JPEG 로 강제 변환해 투명 영역이 검정 배경으로 합성되는 버그가 있었다.)
 */
export function pickOptimizedMimeType(inputType: string): string {
  if (inputType === 'image/png' || inputType === 'image/webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/**
 * 이미지 파일을 최적화합니다.
 * @param file 원본 이미지 파일
 * @param options 최적화 옵션
 * @returns 최적화된 Blob
 */
export async function optimizeImage(
  file: File,
  options: ImageOptimizationOptions = {},
): Promise<Blob> {
  const {
    maxWidth = MAX_WIDTH,
    maxHeight = MAX_HEIGHT,
    quality = QUALITY,
    maxFileSize = MAX_FILE_SIZE,
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 이미지 크기 계산
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            if (width > maxWidth) {
              height = (height * maxWidth) / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = (width * maxHeight) / height;
              height = maxHeight;
            }
          }
        }

        // Canvas 생성 및 이미지 그리기
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas context를 가져올 수 없습니다.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // 출력 포맷 결정: PNG/WebP 는 WebP(투명도 보존 + 품질 압축), 그 외는 JPEG.
        const mimeType = pickOptimizedMimeType(file.type);

        // 품질 설정 (WebP/JPEG 모두 quality 파라미터를 적용)
        let outputQuality = quality;

        // Blob으로 변환
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('이미지 최적화에 실패했습니다.'));
              return;
            }

            // 파일 크기가 여전히 너무 크면 품질을 낮춰서 재시도
            if (blob.size > maxFileSize && outputQuality > 0.5) {
              outputQuality = Math.max(0.5, outputQuality - 0.1);
              canvas.toBlob(
                (reducedBlob) => {
                  if (!reducedBlob) {
                    reject(new Error('이미지 최적화에 실패했습니다.'));
                    return;
                  }
                  resolve(reducedBlob);
                },
                mimeType,
                outputQuality,
              );
            } else {
              resolve(blob);
            }
          },
          mimeType,
          outputQuality,
        );
      };

      img.onerror = () => {
        reject(new Error('이미지를 로드할 수 없습니다.'));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      reject(new Error('파일을 읽을 수 없습니다.'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * 이미지 파일 유효성 검사
 * @param file 파일 객체
 * @returns 검증 결과
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
  ];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: '지원하지 않는 파일 형식입니다. JPG, PNG, GIF, WebP, SVG, BMP만 업로드 가능합니다.',
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: '파일 크기는 10MB 이하여야 합니다.',
    };
  }

  return { valid: true };
}

/**
 * R2에서 이미지를 삭제합니다.
 * @param urls 삭제할 이미지 URL 배열
 * @returns 삭제 성공 여부
 */
export async function deleteImagesFromR2(urls: string[]): Promise<boolean> {
  if (!urls || urls.length === 0) {
    return true;
  }

  // orpc .call 은 실패 시 throw 하므로 try/catch 로 감싸 기존 boolean 반환 계약을 보존한다.
  try {
    await client.media.deleteImages({ urls });
    return true;
  } catch (error) {
    console.error('이미지 삭제 중 오류:', error);
    return false;
  }
}
