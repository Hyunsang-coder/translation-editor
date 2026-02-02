/**
 * Web Attachments Adapter
 *
 * IndexedDB에 파일을 Blob으로 저장합니다.
 */

import type { AttachmentsAdapter, AttachmentDto } from '../types';
import { getDB } from './db';
import { v4 as uuidv4 } from 'uuid';
import { pickFileWithContent } from './dialog';

// ============================================
// Helper Functions
// ============================================

function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext;
}

async function extractTextFromFile(file: File): Promise<string | undefined> {
  const type = file.type;
  const ext = getFileType(file.name);

  // Text-based files
  if (type.startsWith('text/') || ['md', 'txt'].includes(ext)) {
    return await file.text();
  }

  // For PDF, DOCX, etc., text extraction would need additional libraries
  // In web environment, we might use PDF.js or similar
  // For now, return undefined and handle in the future
  return undefined;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================
// Web Attachments Adapter Implementation
// ============================================

export const webAttachmentsAdapter: AttachmentsAdapter = {
  attach: async (projectId, _path) => {
    // In web environment, path is not useful - we need to pick file again
    // This is a limitation of the web platform
    const picked = await pickFileWithContent({
      title: '첨부할 파일 선택',
      filters: [
        {
          name: 'Attachments',
          extensions: ['pdf', 'docx', 'pptx', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
        },
      ],
    });

    if (!picked) {
      throw new Error('No file selected');
    }

    const id = uuidv4();
    const now = Date.now();
    const extractedText = await extractTextFromFile(picked.file);

    const attachment = {
      id,
      projectId,
      filename: picked.name,
      fileType: getFileType(picked.name),
      sizeBytes: picked.size,
      createdAt: now,
      blob: picked.file,
      ...(extractedText ? { extractedText } : {}),
    };

    const db = await getDB();
    await db.put('attachments', attachment);

    const result: AttachmentDto = {
      id,
      filename: picked.name,
      fileType: getFileType(picked.name),
      fileSize: picked.size,
      filePath: null, // Web에서는 파일 경로 없음
      createdAt: now,
      updatedAt: now,
    };
    if (extractedText) {
      result.extractedText = extractedText;
    }
    return result;
  },

  delete: async (id) => {
    const db = await getDB();
    await db.delete('attachments', id);
  },

  list: async (projectId) => {
    const db = await getDB();
    const attachments = await db.getAllFromIndex('attachments', 'by-projectId', projectId);

    return attachments.map((a): AttachmentDto => {
      const result: AttachmentDto = {
        id: a.id,
        filename: a.filename,
        fileType: a.fileType,
        fileSize: a.sizeBytes,
        filePath: null,
        createdAt: a.createdAt,
        updatedAt: a.createdAt, // Web에서는 updatedAt을 createdAt으로 사용
      };
      if (a.extractedText) {
        result.extractedText = a.extractedText;
      }
      return result;
    });
  },

  preview: async (_path) => {
    // In web environment, we need to pick the file
    const picked = await pickFileWithContent({
      title: '미리보기할 파일 선택',
      filters: [
        {
          name: 'Attachments',
          extensions: ['pdf', 'docx', 'pptx', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
        },
      ],
    });

    if (!picked) {
      throw new Error('No file selected');
    }

    const extractedText = await extractTextFromFile(picked.file);
    let thumbnailDataUrl: string | undefined;

    // Generate thumbnail for images
    const imageTypes = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    if (imageTypes.includes(getFileType(picked.name))) {
      thumbnailDataUrl = await fileToDataUrl(picked.file);
    }

    const now = Date.now();
    const result: AttachmentDto = {
      id: uuidv4(), // Temporary ID for preview
      filename: picked.name,
      fileType: getFileType(picked.name),
      fileSize: picked.size,
      filePath: null,
      createdAt: now,
      updatedAt: now,
    };
    if (extractedText) {
      result.extractedText = extractedText;
    }
    if (thumbnailDataUrl) {
      result.thumbnailDataUrl = thumbnailDataUrl;
    }
    return result;
  },

  readImageAsDataUrl: async (_path, _fileType) => {
    // In web environment, this would need the file to be already in IndexedDB
    // or use the File object directly
    // This is a placeholder - actual implementation depends on context
    return null;
  },
};
