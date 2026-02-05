/**
 * Conversion Routes - File upload and conversion endpoints
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs-extra';
import { pipeline } from 'stream/promises';
import { convertFile } from './conversion.service';
import { ValidationError } from '../../common/errors';
import { 
  isSupportedInputFormat, 
  isSupportedOutputFormat,
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_INPUT_FORMATS
} from '../../common/constants';
import { getExtension, sanitizeFilename } from '../../common/utils';
import config from '../../config/env';

/**
 * Generate a unique filename with timestamp prefix and original name
 * Format: {timestamp}_{originalName}.{ext}
 */
function generateTimestampFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const timestamp = Date.now();
  // Sanitize the base name but keep it readable
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${timestamp}_${safeName}${ext}`;
}

export async function conversionRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/convert - Upload and convert a 3D file
   */
  fastify.post('/convert', async (request: FastifyRequest, reply: FastifyReply) => {
    // Parse all parts of the multipart request
    const parts = request.parts();
    
    let originalFilename: string | null = null;
    let inputPath: string | null = null;
    let targetFormat = 'glb';
    const uploadDir = path.resolve(config.uploadDir);
    
    // Ensure upload directory exists
    await fs.ensureDir(uploadDir);
    
    for await (const part of parts) {
      if (part.type === 'file') {
        // Save file immediately while streaming
        originalFilename = part.filename;
        const uniqueFilename = generateTimestampFilename(originalFilename);
        inputPath = path.join(uploadDir, uniqueFilename);
        await pipeline(part.file, fs.createWriteStream(inputPath));
        fastify.log.info(`File uploaded: ${uniqueFilename} (original: ${originalFilename})`);
      } else if (part.type === 'field' && part.fieldname === 'format') {
        targetFormat = String(part.value);
      }
    }
    
    if (!inputPath || !originalFilename) {
      throw new ValidationError('No file uploaded');
    }
    
    fastify.log.info(`Target format: ${targetFormat}`);

    // Validate output format
    if (!isSupportedOutputFormat(targetFormat)) {
      await fs.remove(inputPath).catch(() => {});
      throw new ValidationError(
        `Unsupported output format: ${targetFormat}. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`
      );
    }

    // Validate input format
    const inputFormat = getExtension(originalFilename);
    if (!isSupportedInputFormat(inputFormat)) {
      await fs.remove(inputPath).catch(() => {});
      throw new ValidationError(
        `Unsupported input format: ${inputFormat}. Supported: ${SUPPORTED_INPUT_FORMATS.join(', ')}`
      );
    }

    try {
      // Perform conversion
      const result = await convertFile(inputPath, targetFormat);

      // Delete input file after conversion
      await fs.remove(inputPath).catch(err => {
        fastify.log.warn(`Failed to delete input file: ${err.message}`);
      });

      // Generate download filename: timestamp_originalName.newExt
      const originalBaseName = path.basename(originalFilename, path.extname(originalFilename));
      const safeOriginalName = originalBaseName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const downloadFilename = `${timestamp}_${safeOriginalName}.${targetFormat}`;
      
      // Rename output file to use the download filename
      const outputDir = path.dirname(result.outputPath);
      const finalOutputPath = path.join(outputDir, downloadFilename);
      await fs.move(result.outputPath, finalOutputPath, { overwrite: true });

      return {
        message: 'Conversion successful',
        downloadUrl: `/api/download/${downloadFilename}`,
        originalFilename: `${safeOriginalName}.${targetFormat}`,
        tool: result.tool,
        duration: result.duration,
      };
    } catch (error) {
      // Cleanup input file on error
      await fs.remove(inputPath).catch(() => {});
      throw error;
    }
  });

  /**
   * GET /api/download/:filename - Download a converted file
   */
  fastify.get<{ Params: { filename: string } }>(
    '/download/:filename',
    async (request, reply) => {
      const { filename } = request.params;
      
      // Sanitize filename to prevent path traversal
      const safeFilename = sanitizeFilename(filename);
      const filePath = path.join(path.resolve(config.uploadDir), safeFilename);

      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      // Extract original filename from the stored filename (format: timestamp_originalName.ext)
      // e.g., "1770123456789_MyModel.glb" -> "MyModel.glb"
      let downloadName = safeFilename;
      const underscoreIndex = safeFilename.indexOf('_');
      if (underscoreIndex > 0) {
        // Check if the part before underscore looks like a timestamp (all digits)
        const prefix = safeFilename.substring(0, underscoreIndex);
        if (/^\d+$/.test(prefix)) {
          downloadName = safeFilename.substring(underscoreIndex + 1);
        }
      }

      // Set headers for download with original filename
      reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
      reply.header('Content-Type', 'application/octet-stream');

      // Stream the file
      const stream = fs.createReadStream(filePath);
      
      // Delete file after sending (fire and forget)
      stream.on('end', () => {
        fs.remove(filePath).catch(err => {
          fastify.log.warn(`Failed to delete output file: ${err.message}`);
        });
      });

      return reply.send(stream);
    }
  );

  /**
   * POST /api/cleanup - Manual cleanup of all uploaded files
   */
  fastify.post('/cleanup', async (request, reply) => {
    const uploadDir = path.resolve(config.uploadDir);
    
    try {
      const files = await fs.readdir(uploadDir);
      let deleted = 0;
      
      for (const file of files) {
        if (file === '.keep' || file === '.gitkeep') continue;
        await fs.remove(path.join(uploadDir, file));
        deleted++;
      }
      
      return { 
        message: 'Cleanup successful', 
        filesDeleted: deleted 
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Cleanup error');
      throw error;
    }
  });

  /**
   * GET /api/formats - List supported formats
   */
  fastify.get('/formats', async () => {
    return {
      input: [...SUPPORTED_INPUT_FORMATS],
      output: [...SUPPORTED_OUTPUT_FORMATS],
    };
  });
}
