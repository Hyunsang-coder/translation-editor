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

export async function readFileBytes(path: string): Promise<number[]> {
    return await invoke<number[]>('read_file_bytes', { args: { path } });
}

/**
 * 이미지 바이트를 임시 파일로 저장하고 경로를 반환
 * - 드래그앤드롭 또는 클립보드에서 이미지를 붙여넣을 때 사용
 * @param bytes 이미지 바이트 배열
 * @param filename 원본 파일명 (확장자 포함)
 * @returns 저장된 임시 파일 경로
 */
export async function saveTempImage(bytes: number[], filename: string): Promise<string> {
    return await invoke<string>('save_temp_image', { bytes, filename });
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
        const bytes = await readFileBytes(path);

        // 보안: 파일 크기 검증 (메모리 고갈 방지)
        if (bytes.length > maxSizeBytes) {
            throw new ImageSizeExceededError(bytes.length, maxSizeBytes);
        }

        const uint8Array = new Uint8Array(bytes);

        // Uint8Array를 base64로 변환
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            const byte = uint8Array[i];
            if (byte !== undefined) {
                binary += String.fromCharCode(byte);
            }
        }
        const base64 = btoa(binary);

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
