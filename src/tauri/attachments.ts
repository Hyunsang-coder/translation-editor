import { invoke } from './invoke';

// 이미지 Base64 변환 최대 크기 (10MB)
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export class ImageSizeExceededError extends Error {
    constructor(actualSize: number, maxSize: number) {
        super(`이미지 크기(${(actualSize / 1024 / 1024).toFixed(2)}MB)가 최대 허용 크기(${(maxSize / 1024 / 1024).toFixed(0)}MB)를 초과합니다.`);
        this.name = 'ImageSizeExceededError';
    }
}

export interface AttachmentDto {
    id: string;
    filename: string;
    fileType: string;
    fileSize: number | null;
    extractedText?: string;
    extractedTextLength: number | null;
    filePath: string | null;
    createdAt: number;
    updatedAt: number;
    /** 이미지 첨부 시 미리보기용 base64 data URL (프론트엔드 전용) */
    thumbnailDataUrl?: string;
}

export async function attachFile(projectId: string, path: string): Promise<AttachmentDto> {
    return await invoke<AttachmentDto>('attach_file', { args: { projectId, path } });
}

export async function listAttachments(projectId: string): Promise<AttachmentDto[]> {
    return await invoke<AttachmentDto[]>('list_attachments', { projectId });
}

export async function deleteAttachment(id: string): Promise<void> {
    return await invoke<void>('delete_attachment', { id });
}

export async function previewAttachment(path: string): Promise<AttachmentDto> {
    return await invoke<AttachmentDto>('preview_attachment', { args: { path } });
}

/**
 * 로컬 파일을 base64 문자열로 읽습니다.
 * - number[] JSON 직렬화(5MB 이미지 → ~20MB JSON) 비용을 피하기 위해
 *   Rust에서 base64로 인코딩해 문자열 하나로 전달합니다. (P5)
 */
export async function readFileBase64(path: string): Promise<string> {
    return await invoke<string>('read_file_bytes', { args: { path } });
}

/**
 * Blob을 base64 문자열로 변환합니다 (data URL prefix 제거).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const commaIdx = result.indexOf(',');
            resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
    });
}

/**
 * 이미지 Blob을 임시 파일로 저장하고 경로를 반환
 * - 드래그앤드롭 또는 클립보드에서 이미지를 붙여넣을 때 사용
 * - number[] JSON 직렬화 비용을 피하기 위해 base64 문자열로 IPC합니다. (P5)
 * @param blob 이미지 Blob (File 포함)
 * @param filename 원본 파일명 (확장자 포함)
 * @returns 저장된 임시 파일 경로
 */
export async function saveTempImage(blob: Blob, filename: string): Promise<string> {
    const bytesBase64 = await blobToBase64(blob);
    return await invoke<string>('save_temp_image', { bytesBase64, filename });
}

/**
 * 오래된 임시 이미지 파일 정리 (24시간 이상 된 파일 삭제)
 * - 앱 시작 시 호출하여 디스크 공간 확보
 * @returns 삭제된 파일 수
 */
export async function cleanupTempImages(): Promise<number> {
    return await invoke<number>('cleanup_temp_images', {});
}

/**
 * 이미지 파일을 읽어서 base64 data URL로 변환
 * @param path 파일 경로
 * @param fileType 파일 확장자 (png, jpg, jpeg, gif, webp)
 * @param maxSizeBytes 최대 허용 크기 (바이트, 기본값: 10MB)
 * @returns base64 data URL 또는 null (읽기 실패 시)
 * @throws ImageSizeExceededError 파일 크기가 최대 허용 크기 초과 시
 */
export async function readImageAsDataUrl(
    path: string,
    fileType: string,
    maxSizeBytes: number = MAX_IMAGE_SIZE_BYTES
): Promise<string | null> {
    try {
        const base64 = await readFileBase64(path);

        // 보안: 파일 크기 검증 (메모리 고갈 방지).
        // base64는 4문자당 3바이트이며, 끝의 '=' 패딩 개수만큼 원본 바이트가 줄어든다.
        // ceil(len*3/4)는 패딩만큼 최대 2바이트 과대계상해 경계값(정확히 maxSizeBytes)을
        // 오탐 거부하므로, 패딩을 빼 실제 디코딩 바이트 수를 정확히 구한다.
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        const decodedBytes = (base64.length * 3) / 4 - padding;
        if (decodedBytes > maxSizeBytes) {
            throw new ImageSizeExceededError(decodedBytes, maxSizeBytes);
        }

        // MIME 타입 결정
        const mimeType = fileType.toLowerCase() === 'jpg' ? 'image/jpeg'
            : `image/${fileType.toLowerCase()}`;

        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        // ImageSizeExceededError는 다시 throw
        if (error instanceof ImageSizeExceededError) {
            throw error;
        }
        console.error('Failed to read image as data URL:', error);
        return null;
    }
}
