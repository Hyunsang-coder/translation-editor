/**
 * File/Blob 처리 유틸리티
 * - 드래그앤드롭 및 클립보드 붙여넣기에서 이미지 처리를 위해 사용
 */

/**
 * File 또는 Blob을 number[] 바이트 배열로 변환
 * - Tauri 커맨드로 바이너리 데이터를 전송할 때 사용
 * @param file File 또는 Blob 객체
 * @returns number[] 바이트 배열
 */
export async function fileToBytes(file: File | Blob): Promise<number[]> {
    const buffer = await file.arrayBuffer();
    return Array.from(new Uint8Array(buffer));
}

/**
 * 이미지 MIME 타입인지 확인
 * @param type MIME 타입 문자열
 * @returns 이미지 타입 여부
 */
export function isImageMimeType(type: string): boolean {
    return type.startsWith('image/');
}

/**
 * 지원되는 이미지 확장자 목록
 */
export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/**
 * 파일 확장자가 지원되는 이미지인지 확인
 * @param filename 파일명
 * @returns 지원되는 이미지 확장자 여부
 */
export function isSupportedImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

/**
 * File 객체가 이미지인지 확인 (MIME 타입 + 확장자 모두 체크)
 * - Tauri 환경에서 드래그앤드롭 시 file.type이 빈 문자열일 수 있으므로 확장자도 체크
 * @param file File 객체
 * @returns 이미지 파일 여부
 */
export function isImageFile(file: File): boolean {
    // MIME 타입으로 먼저 체크
    if (file.type && isImageMimeType(file.type)) {
        return true;
    }
    // MIME 타입이 없거나 빈 문자열이면 확장자로 체크
    return isSupportedImageFile(file.name);
}
