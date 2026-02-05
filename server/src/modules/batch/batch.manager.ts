/**
 * Batch Job Manager - Handles batch conversion queue and status tracking
 */

import { v4 as uuidv4 } from 'uuid';
import { BatchJob, BatchFile, FileStatus, BatchStatusResult } from './batch.types';
import { convertFile } from '../conversion/conversion.service';
import path from 'path';
import fs from 'fs-extra';

// In-memory storage for batch jobs (could be Redis in production)
const jobs = new Map<string, BatchJob>();

// Cleanup old jobs after 1 hour
const JOB_TTL_MS = 60 * 60 * 1000;

/**
 * Create a new batch job
 */
export function createBatchJob(files: Omit<BatchFile, 'status' | 'downloadUrl' | 'outputPath' | 'error' | 'tool' | 'duration'>[]): BatchJob {
  const jobId = uuidv4();
  
  const batchFiles: BatchFile[] = files.map(f => ({
    ...f,
    status: 'pending' as FileStatus,
    downloadUrl: null,
    outputPath: null,
    error: null,
    tool: null,
    duration: null,
  }));

  const job: BatchJob = {
    jobId,
    createdAt: new Date(),
    files: batchFiles,
    isProcessing: false,
    completedCount: 0,
    totalCount: files.length,
  };

  jobs.set(jobId, job);
  
  // Schedule cleanup after TTL
  setTimeout(() => {
    cleanupJob(jobId);
  }, JOB_TTL_MS);

  return job;
}

/**
 * Get batch job status
 */
export function getBatchJobStatus(jobId: string): BatchStatusResult | null {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    jobId: job.jobId,
    isProcessing: job.isProcessing,
    completedCount: job.completedCount,
    totalCount: job.totalCount,
    files: job.files.map(f => ({
      id: f.id,
      originalName: f.originalName,
      inputFormat: f.inputFormat,
      outputFormat: f.outputFormat,
      status: f.status,
      downloadUrl: f.downloadUrl,
      error: f.error,
      tool: f.tool,
      duration: f.duration,
    })),
  };
}

/**
 * Get batch job (internal)
 */
export function getBatchJob(jobId: string): BatchJob | null {
  return jobs.get(jobId) || null;
}

/**
 * Process batch job - converts files sequentially
 */
export async function processBatchJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) {
    console.error(`[Batch] Job not found: ${jobId}`);
    return;
  }

  if (job.isProcessing) {
    console.log(`[Batch] Job already processing: ${jobId}`);
    return;
  }

  job.isProcessing = true;
  console.log(`[Batch] Starting batch processing for job ${jobId} (${job.totalCount} files)`);

  for (const file of job.files) {
    if (file.status !== 'pending') continue;

    // Update status to converting
    file.status = 'converting';
    console.log(`[Batch] Converting file: ${file.originalName} (${file.inputFormat} → ${file.outputFormat})`);

    try {
      const result = await convertFile(file.inputPath, file.outputFormat);
      
      // Generate download filename
      const originalBaseName = path.basename(file.originalName, path.extname(file.originalName));
      const safeOriginalName = originalBaseName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const downloadFilename = `${timestamp}_${safeOriginalName}.${file.outputFormat}`;
      
      // Rename output file
      const outputDir = path.dirname(result.outputPath);
      const finalOutputPath = path.join(outputDir, downloadFilename);
      await fs.move(result.outputPath, finalOutputPath, { overwrite: true });

      // Update file status
      file.status = 'completed';
      file.downloadUrl = `/api/download/${downloadFilename}`;
      file.outputPath = finalOutputPath;
      file.tool = result.tool;
      file.duration = result.duration;
      job.completedCount++;

      // Cleanup input file
      await fs.remove(file.inputPath).catch(() => {});

      console.log(`[Batch] ✓ Completed: ${file.originalName} (${result.tool}, ${result.duration}ms)`);
    } catch (error) {
      file.status = 'error';
      file.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedCount++;

      // Cleanup input file on error
      await fs.remove(file.inputPath).catch(() => {});

      console.error(`[Batch] ✗ Failed: ${file.originalName} - ${file.error}`);
    }
  }

  job.isProcessing = false;
  console.log(`[Batch] Batch processing complete for job ${jobId}`);
}

/**
 * Cleanup a batch job and its files
 */
export async function cleanupJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  console.log(`[Batch] Cleaning up job ${jobId}`);

  // Delete all output files
  for (const file of job.files) {
    if (file.outputPath) {
      await fs.remove(file.outputPath).catch(() => {});
    }
    if (file.inputPath) {
      await fs.remove(file.inputPath).catch(() => {});
    }
  }

  jobs.delete(jobId);
}

/**
 * Get all output file paths for a job (for ZIP creation)
 */
export function getJobOutputFiles(jobId: string): Array<{ path: string; name: string }> | null {
  const job = jobs.get(jobId);
  if (!job) return null;

  return job.files
    .filter(f => f.status === 'completed' && f.outputPath)
    .map(f => ({
      path: f.outputPath!,
      name: `${path.basename(f.originalName, path.extname(f.originalName))}.${f.outputFormat}`,
    }));
}
