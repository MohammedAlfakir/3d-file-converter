/**
 * Conversion Service - Smart routing between conversion tools
 * 
 * Decision Matrix:
 * 
 * 1. DXF ↔ DWG: Use ODA File Converter (direct format swap)
 * 
 * 2. Any format → DWG: Convert to DXF first (Blender), then DXF → DWG (ODA)
 * 
 * 3. DWG/DXF INPUT → Any format: Use Autodesk APS (handles ACIS 3D solids)
 * 
 * 4. Any format → DXF: Use Blender directly
 * 
 * 5. Simple Mesh → Simple Mesh: Assimp → Blender → FreeCAD → APS (fallback chain)
 * 
 * 6. CAD formats: Blender → FreeCAD → APS (fallback chain)
 * 
 * 7. Fallback: Try full chain for any other formats
 * 
 * This allows converting ANY format to ANY format with maximum compatibility.
 */

import path from 'path';
import fs from 'fs-extra';
import { 
  blenderConvert, 
  assimpConvert,
  odaConvert,
  convertWithFreecad,
  canFreecadHandle,
  apsConvert,
  isApsAvailable
} from './providers';
import { 
  isSimpleMesh, 
  isCadFormat, 
  isDwgFormat, 
  isDxfFile,
  getExtension,
  generateOutputFilename 
} from '../../common/utils';
import { 
  ConversionError, 
  UnsupportedFormatError 
} from '../../common/errors';
import { 
  isSupportedInputFormat, 
  isSupportedOutputFormat 
} from '../../common/constants';

interface ConversionResult {
  outputPath: string;
  tool: 'assimp' | 'blender' | 'oda' | 'pipeline' | 'aps';
  duration: number;
}

// =====================================================
// LOGGING HELPER
// =====================================================
function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
  const prefix = '[Conversion]';
  const icons = {
    info: '→',
    success: '✓',
    error: '✗',
    warn: '⚠'
  };
  console.log(`${prefix} ${icons[type]} ${message}`);
}

/**
 * Convert a 3D file to the target format
 * 
 * This function implements the "Assimp First, Blender Fallback" strategy
 * with special handling for DWG files via ODA.
 */
export async function convertFile(
  inputPath: string,
  outputFormat: string
): Promise<ConversionResult> {
  const startTime = Date.now();
  const inputFormat = getExtension(inputPath);
  const normalizedOutputFormat = outputFormat.toLowerCase();
  const inputFilename = path.basename(inputPath);

  log(`Starting conversion: ${inputFormat.toUpperCase()} → ${normalizedOutputFormat.toUpperCase()}`);
  log(`Input file: ${inputFilename}`);

  // Validate formats
  if (!isSupportedInputFormat(inputFormat)) {
    log(`Unsupported input format: ${inputFormat}`, 'error');
    throw new UnsupportedFormatError(inputFormat);
  }
  if (!isSupportedOutputFormat(normalizedOutputFormat)) {
    log(`Unsupported output format: ${normalizedOutputFormat}`, 'error');
    throw new UnsupportedFormatError(normalizedOutputFormat);
  }

  // Generate output path
  const inputDir = path.dirname(inputPath);
  const outputFilename = generateOutputFilename(path.basename(inputPath), normalizedOutputFormat);
  const outputPath = path.join(inputDir, outputFilename);

  // Same format - just copy
  if (inputFormat === normalizedOutputFormat) {
    log(`Same format detected, copying file...`);
    await fs.copy(inputPath, outputPath);
    log(`Copy complete`, 'success');
    return {
      outputPath,
      tool: 'assimp', // No conversion needed
      duration: Date.now() - startTime
    };
  }

  let tool: ConversionResult['tool'];

  // =====================================================
  // 1. DXF ↔ DWG (Use ODA - direct format swap)
  // =====================================================
  if ((inputFormat === 'dxf' && normalizedOutputFormat === 'dwg') ||
      (inputFormat === 'dwg' && normalizedOutputFormat === 'dxf')) {
    log(`Route: DXF ↔ DWG swap`);
    log(`Trying ODA File Converter...`);
    const odaOutputFormat = normalizedOutputFormat.toUpperCase() as 'DXF' | 'DWG';
    try {
      const odaOutputPath = await odaConvert(inputPath, odaOutputFormat);
      log(`ODA conversion successful`, 'success');
      // Move ODA output to expected output path if different
      if (odaOutputPath !== outputPath) {
        await fs.move(odaOutputPath, outputPath, { overwrite: true });
      }
      return {
        outputPath,
        tool: 'oda',
        duration: Date.now() - startTime
      };
    } catch (odaErr) {
      log(`ODA conversion failed: ${odaErr instanceof Error ? odaErr.message : String(odaErr)}`, 'error');
      throw new ConversionError(
        `Failed to convert ${inputFormat.toUpperCase()} to ${normalizedOutputFormat.toUpperCase()}`,
        `ODA File Converter failed. Error: ${odaErr instanceof Error ? odaErr.message : String(odaErr)}`
      );
    }
  }

  // =====================================================
  // 2. Any format → DWG (via DXF intermediate using Blender + ODA)
  // =====================================================
  if (normalizedOutputFormat === 'dwg' && inputFormat !== 'dxf') {
    log(`Route: Any → DWG (via DXF intermediate)`);
    const tempDxfPath = path.join(inputDir, `temp_${Date.now()}.dxf`);
    
    try {
      // Step 1: Convert to DXF via Blender
      log(`Step 1: Trying Blender (${inputFormat.toUpperCase()} → DXF)...`);
      await blenderConvert(inputPath, tempDxfPath);
      log(`Step 1: Blender conversion successful`, 'success');
      
      // Step 2: Convert DXF to DWG via ODA
      log(`Step 2: Trying ODA (DXF → DWG)...`);
      const odaOutputPath = await odaConvert(tempDxfPath, 'DWG');
      log(`Step 2: ODA conversion successful`, 'success');
      
      // Move ODA output to expected output path
      if (odaOutputPath !== outputPath) {
        await fs.move(odaOutputPath, outputPath, { overwrite: true });
      }
      
      log(`Pipeline complete: ${inputFormat.toUpperCase()} → DXF → DWG`, 'success');
      return {
        outputPath,
        tool: 'pipeline', // Blender + ODA
        duration: Date.now() - startTime
      };
    } catch (err) {
      log(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      throw new ConversionError(
        `Failed to convert ${inputFormat.toUpperCase()} to DWG`,
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      await fs.remove(tempDxfPath).catch(() => {});
    }
  }

  // =====================================================
  // 3. DWG/DXF INPUT → Any mesh format (Use Autodesk APS)
  // =====================================================
  const inputIsDwgDxf = isDwgFormat(inputFormat) || inputFormat === 'dxf';
  
  if (inputIsDwgDxf) {
    log(`Route: DWG/DXF input → mesh output`);
    
    // Check if APS is available
    if (!isApsAvailable()) {
      log(`APS not configured (APS_CLIENT_ID/APS_CLIENT_SECRET missing)`, 'error');
      throw new ConversionError(
        'DWG/DXF conversion requires Autodesk APS',
        'DWG/DXF files require Autodesk cloud conversion. ' +
        'Configure APS_CLIENT_ID and APS_CLIENT_SECRET environment variables to enable this feature.'
      );
    }
    
    // Cast to string for flexible comparison
    const outFmt = normalizedOutputFormat as string;
    
    // Direct to OBJ/STL
    if (outFmt === 'obj' || outFmt === 'stl') {
      log(`Trying APS direct (${inputFormat.toUpperCase()} → ${outFmt.toUpperCase()})...`);
      try {
        await apsConvert(inputPath, outputPath, { 
          outputFormat: outFmt as 'obj' | 'stl' 
        });
        log(`APS conversion successful`, 'success');
        return {
          outputPath,
          tool: 'aps',
          duration: Date.now() - startTime
        };
      } catch (apsErr) {
        log(`APS conversion failed: ${apsErr instanceof Error ? apsErr.message : String(apsErr)}`, 'error');
        throw new ConversionError(
          `Failed to convert ${inputFormat.toUpperCase()} to ${normalizedOutputFormat.toUpperCase()}`,
          `Autodesk APS cloud conversion failed. Error: ${apsErr instanceof Error ? apsErr.message : String(apsErr)}`
        );
      }
    }
    
    // Other mesh formats: DWG/DXF → OBJ → target format
    log(`Pipeline: ${inputFormat.toUpperCase()} → OBJ → ${normalizedOutputFormat.toUpperCase()}`);
    const tempObjPath = path.join(inputDir, `temp_${Date.now()}.obj`);
    
    try {
      // Step 1: Convert to OBJ via APS
      log(`Step 1: Trying APS (${inputFormat.toUpperCase()} → OBJ)...`);
      await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
      log(`Step 1: APS conversion successful`, 'success');
      
      // Step 2: Convert OBJ to final format
      log(`Step 2: Converting OBJ → ${normalizedOutputFormat.toUpperCase()}...`);
      await convertWithFullFallback(tempObjPath, outputPath);
      log(`Step 2: Conversion successful`, 'success');
      
      log(`Pipeline complete`, 'success');
      return {
        outputPath,
        tool: 'pipeline', // APS + Blender/Assimp
        duration: Date.now() - startTime
      };
    } catch (err) {
      log(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      throw new ConversionError(
        `Failed to convert ${inputFormat.toUpperCase()} to ${normalizedOutputFormat.toUpperCase()}`,
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      await fs.remove(tempObjPath).catch(() => {});
    }
  }

  // =====================================================
  // 4. Any format → DXF (Use Blender)
  // =====================================================
  if (normalizedOutputFormat === 'dxf') {
    log(`Route: Any → DXF`);
    log(`Trying Blender...`);
    try {
      await blenderConvert(inputPath, outputPath);
      log(`Blender conversion successful`, 'success');
      return {
        outputPath,
        tool: 'blender',
        duration: Date.now() - startTime
      };
    } catch (blenderErr) {
      log(`Blender failed: ${blenderErr instanceof Error ? blenderErr.message : String(blenderErr)}`, 'error');
      throw new ConversionError(
        `Failed to convert ${inputFormat.toUpperCase()} to DXF`,
        `Blender could not export to DXF. Error: ${blenderErr instanceof Error ? blenderErr.message : String(blenderErr)}`
      );
    }
  }

  // =====================================================
  // 5. SIMPLE MESH → SIMPLE MESH: Assimp → Blender → FreeCAD → APS
  // =====================================================
  if (isSimpleMesh(inputFormat) && isSimpleMesh(normalizedOutputFormat)) {
    log(`Route: Simple mesh → Simple mesh`);
    
    tool = await convertWithFullFallback(inputPath, outputPath);
    
    log(`Conversion complete using ${tool}`, 'success');
    return {
      outputPath,
      tool,
      duration: Date.now() - startTime
    };
  }

  // =====================================================
  // 6. CAD FORMATS: Blender → FreeCAD → APS
  // =====================================================
  if (isCadFormat(inputFormat) || isCadFormat(normalizedOutputFormat)) {
    log(`Route: CAD format conversion`);
    log(`Trying Blender...`);
    
    try {
      await blenderConvert(inputPath, outputPath);
      log(`Blender conversion successful`, 'success');
      return {
        outputPath,
        tool: 'blender',
        duration: Date.now() - startTime
      };
    } catch (blenderErr) {
      log(`Blender failed, trying FreeCAD...`, 'warn');
      
      // Cast for flexible comparison
      const outFmt = normalizedOutputFormat as string;
      
      if (canFreecadHandle(inputFormat)) {
        const tempStlPath = path.join(inputDir, `temp_${Date.now()}.stl`);
        try {
          log(`Trying FreeCAD...`);
          const freecadResult = await convertWithFreecad(inputPath, 'stl');
          await fs.move(freecadResult.outputPath, tempStlPath, { overwrite: true });
          log(`FreeCAD conversion successful`, 'success');
          
          if (outFmt === 'stl') {
            await fs.move(tempStlPath, outputPath, { overwrite: true });
          } else {
            log(`Converting STL → ${outFmt.toUpperCase()}...`);
            await convertWithFullFallback(tempStlPath, outputPath);
          }
          
          log(`Pipeline complete`, 'success');
          return {
            outputPath,
            tool: 'pipeline',
            duration: Date.now() - startTime
          };
        } catch (freecadErr) {
          log(`FreeCAD failed, trying APS as last resort...`, 'warn');
          
          // Try APS as ultimate fallback
          if (isApsAvailable()) {
            try {
              log(`Trying APS...`);
              const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
              await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
              log(`APS conversion successful`, 'success');
              
              if (outFmt === 'obj') {
                await fs.move(tempObjPath, outputPath, { overwrite: true });
              } else {
                log(`Converting OBJ → ${outFmt.toUpperCase()}...`);
                await convertWithFullFallback(tempObjPath, outputPath);
                await fs.remove(tempObjPath).catch(() => {});
              }
              
              log(`Pipeline complete`, 'success');
              return {
                outputPath,
                tool: 'aps',
                duration: Date.now() - startTime
              };
            } catch (apsErr) {
              log(`APS also failed`, 'error');
            }
          }
          
          throw new ConversionError(
            `Failed to convert ${inputFormat.toUpperCase()} to ${normalizedOutputFormat.toUpperCase()}`,
            'All conversion methods failed (Blender, FreeCAD, APS).'
          );
        } finally {
          await fs.remove(tempStlPath).catch(() => {});
        }
      }
      
      // FreeCAD can't handle this format, try APS directly
      if (isApsAvailable()) {
        log(`FreeCAD cannot handle ${inputFormat}, trying APS directly...`);
        try {
          log(`Trying APS...`);
          const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
          await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
          log(`APS conversion successful`, 'success');
          
          if (outFmt === 'obj') {
            await fs.move(tempObjPath, outputPath, { overwrite: true });
          } else {
            log(`Converting OBJ → ${outFmt.toUpperCase()}...`);
            await convertWithFullFallback(tempObjPath, outputPath);
            await fs.remove(tempObjPath).catch(() => {});
          }
          
          log(`Pipeline complete`, 'success');
          return {
            outputPath,
            tool: 'aps',
            duration: Date.now() - startTime
          };
        } catch (apsErr) {
          log(`APS also failed`, 'error');
        }
      }
      
      throw blenderErr;
    }
  }

  // =====================================================
  // 7. FALLBACK - Try full chain for any other formats
  // =====================================================
  log(`Route: Fallback chain`);
  tool = await convertWithFullFallback(inputPath, outputPath);
  
  log(`Conversion complete using ${tool}`, 'success');
  return {
    outputPath,
    tool,
    duration: Date.now() - startTime
  };
}

/**
 * Full fallback chain: Assimp → Blender → FreeCAD → APS
 * Tries each converter in order until one succeeds
 */
async function convertWithFullFallback(
  inputPath: string,
  outputPath: string
): Promise<ConversionResult['tool']> {
  const inputFormat = getExtension(inputPath);
  const outputFormat = getExtension(outputPath);
  const inputDir = path.dirname(inputPath);

  log(`Fallback chain: ${inputFormat.toUpperCase()} → ${outputFormat.toUpperCase()}`);

  // 1. Try Assimp first (fast, good for simple meshes)
  if (isSimpleMesh(inputFormat) && isSimpleMesh(outputFormat)) {
    try {
      log(`Trying Assimp...`);
      await assimpConvert(inputPath, outputPath);
      log(`Assimp conversion successful`, 'success');
      return 'assimp';
    } catch (err) {
      log(`Assimp failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'warn');
    }
  }

  // 2. Try Blender
  try {
    log(`Trying Blender...`);
    await blenderConvert(inputPath, outputPath);
    log(`Blender conversion successful`, 'success');
    return 'blender';
  } catch (err) {
    log(`Blender failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'warn');
  }

  // 3. Try FreeCAD
  if (canFreecadHandle(inputFormat)) {
    const tempStlPath = path.join(inputDir, `temp_freecad_${Date.now()}.stl`);
    try {
      log(`Trying FreeCAD...`);
      const freecadResult = await convertWithFreecad(inputPath, 'stl');
      await fs.move(freecadResult.outputPath, tempStlPath, { overwrite: true });
      log(`FreeCAD conversion to STL successful`, 'success');
      
      if (outputFormat === 'stl') {
        await fs.move(tempStlPath, outputPath, { overwrite: true });
        log(`Output is STL, done`, 'success');
      } else {
        // Convert STL to final format via Blender
        log(`Converting STL → ${outputFormat.toUpperCase()} via Blender...`);
        await blenderConvert(tempStlPath, outputPath);
        log(`STL → ${outputFormat.toUpperCase()} successful`, 'success');
      }
      return 'pipeline';
    } catch (err) {
      log(`FreeCAD failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'warn');
    } finally {
      await fs.remove(tempStlPath).catch(() => {});
    }
  }

  // 4. Try APS as ultimate fallback
  if (isApsAvailable()) {
    const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
    try {
      log(`Trying APS as last resort...`);
      await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
      log(`APS conversion to OBJ successful`, 'success');
      
      if (outputFormat === 'obj') {
        await fs.move(tempObjPath, outputPath, { overwrite: true });
        log(`Output is OBJ, done`, 'success');
      } else {
        log(`Converting OBJ → ${outputFormat.toUpperCase()} via Blender...`);
        await blenderConvert(tempObjPath, outputPath);
        log(`OBJ → ${outputFormat.toUpperCase()} successful`, 'success');
        await fs.remove(tempObjPath).catch(() => {});
      }
      return 'aps';
    } catch (err) {
      log(`APS failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      await fs.remove(tempObjPath).catch(() => {});
    }
  }

  // All methods failed
  log(`All conversion methods failed!`, 'error');
  throw new ConversionError(
    `Failed to convert ${inputFormat.toUpperCase()} to ${outputFormat.toUpperCase()}`,
    'All conversion methods failed (Assimp, Blender, FreeCAD, APS). ' +
    'The file may be corrupted or in an unsupported format.'
  );
}