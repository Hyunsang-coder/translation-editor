import { invoke } from './invoke';

export interface AttachmentDto {
    id: string;
    filename: string;
    fileType: string;
    fileSize: number | null;
    extractedText?: string;
    createdAt: number;
    updatedAt: number;
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
