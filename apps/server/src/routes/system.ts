import type { FastifyInstance } from 'fastify';
import type { ApiError, PickFolderResponse } from '@sleepy-coder/shared';
import { FolderPickerError, type FolderPicker, type FolderPickerErrorCode } from '../services/folder-picker.js';

const STATUS_BY_CODE: Record<FolderPickerErrorCode, number> = {
  'unsupported-platform': 501,
  'picker-busy': 409,
  'picker-failed': 500,
};

export interface SystemRoutesOptions {
  folderPicker: FolderPicker;
}

export async function systemRoutes(app: FastifyInstance, { folderPicker }: SystemRoutesOptions): Promise<void> {
  /** Opens the native folder dialog on this machine and returns the chosen path (null if cancelled). */
  app.post('/system/pick-folder', async (_request, reply) => {
    try {
      const response: PickFolderResponse = { path: await folderPicker.pick() };
      return response;
    } catch (error) {
      if (!(error instanceof FolderPickerError)) throw error;
      const body: ApiError = { error: error.code, message: error.message };
      return reply.code(STATUS_BY_CODE[error.code]).send(body);
    }
  });
}