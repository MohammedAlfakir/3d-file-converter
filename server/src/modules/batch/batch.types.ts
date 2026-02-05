/**
 * Batch Conversion Types
 */

export type FileStatus = 'pending' | 'converting' | 'completed' | 'error';

export interface BatchFile {
  id: string;
  originalName: string;
  inputPath: string;
  inputFormat: string;
  outputFormat: string;
  status: FileStatus;
  downloadUrl: string | null;
  outputPath: string | null;
  error: string | null;
  tool: string | null;
  duration: number | null;
}

export interface BatchJob {
  jobId: string;
  createdAt: Date;
  files: BatchFile[];
  isProcessing: boolean;
  completedCount: number;
  totalCount: number;
}

export interface BatchUploadResult {
  jobId: string;
  files: Array<{
    id: string;
    originalName: string;
    inputFormat: string;
    outputFormat: string;
    status: FileStatus;
  }>;
}

export interface BatchStatusResult {
  jobId: string;
  isProcessing: boolean;
  completedCount: number;
  totalCount: number;
  files: Array<{
    id: string;
    originalName: string;
    inputFormat: string;
    outputFormat: string;
    status: FileStatus;
    downloadUrl: string | null;
    error: string | null;
    tool: string | null;
    duration: number | null;
  }>;
}
