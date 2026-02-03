/**
 * Conversion Service - Smart routing between conversion tools
 * 
 * Decision Matrix:
 * 
 * 1. DXF ↔ DWG: Use ODA File Converter (direct format swap)
 * 
 * 2. DWG/DXF INPUT → Any format: Use Autodesk APS (handles ACIS 3D solids)
 * 
 * 3. Any format → DWG: Convert to DXF first (Blender), then DXF → DWG (ODA)
 * 
 * 4. Any format → DXF: Use Blender directly
 * 
 * 5. Simple Mesh → Simple Mesh: Assimp → Blender → FreeCAD → APS (fallback chain)
 * 
 * 6. CAD formats: Blender → FreeCAD → APS (fallback chain)
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

  // Validate formats
  if (!isSupportedInputFormat(inputFormat)) {
    throw new UnsupportedFormatError(inputFormat);
  }
  if (!isSupportedOutputFormat(normalizedOutputFormat)) {
    throw new UnsupportedFormatError(normalizedOutputFormat);
  }

  // Generate output path
  const inputDir = path.dirname(inputPath);
  const outputFilename = generateOutputFilename(path.basename(inputPath), normalizedOutputFormat);
  const outputPath = path.join(inputDir, outputFilename);

  // Same format - just copy
  if (inputFormat === normalizedOutputFormat) {
    await fs.copy(inputPath, outputPath);
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
    console.log(`[ConversionService] DXF ↔ DWG conversion, using ODA File Converter...`);
    const odaOutputFormat = normalizedOutputFormat.toUpperCase() as 'DXF' | 'DWG';
    try {
      const odaOutputPath = await odaConvert(inputPath, odaOutputFormat);
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
      console.error(`[ConversionService] ODA conversion failed:`, odaErr);
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
    console.log(`[ConversionService] Converting ${inputFormat.toUpperCase()} → DXF → DWG...`);
    const tempDxfPath = path.join(inputDir, `temp_${Date.now()}.dxf`);
    
    try {
      // Step 1: Convert to DXF via Blender
      await blenderConvert(inputPath, tempDxfPath);
      
      // Step 2: Convert DXF to DWG via ODA
      const odaOutputPath = await odaConvert(tempDxfPath, 'DWG');
      
      // Move ODA output to expected output path
      if (odaOutputPath !== outputPath) {
        await fs.move(odaOutputPath, outputPath, { overwrite: true });
      }
      
      return {
        outputPath,
        tool: 'pipeline', // Blender + ODA
        duration: Date.now() - startTime
      };
    } catch (err) {
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
    console.log(`[ConversionService] DWG/DXF input detected, using Autodesk APS...`);
    
    // Check if APS is available
    if (!isApsAvailable()) {
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
      try {
        await apsConvert(inputPath, outputPath, { 
          outputFormat: outFmt as 'obj' | 'stl' 
        });
        return {
          outputPath,
          tool: 'aps',
          duration: Date.now() - startTime
        };
      } catch (apsErr) {
        console.error(`[ConversionService] APS conversion failed:`, apsErr);
        throw new ConversionError(
          `Failed to convert ${inputFormat.toUpperCase()} to ${normalizedOutputFormat.toUpperCase()}`,
          `Autodesk APS cloud conversion failed. Error: ${apsErr instanceof Error ? apsErr.message : String(apsErr)}`
        );
      }
    }
    
    // Other mesh formats: DWG/DXF → OBJ → target format
    console.log(`[ConversionService] Converting DWG/DXF → OBJ → ${normalizedOutputFormat.toUpperCase()}...`);
    const tempObjPath = path.join(inputDir, `temp_${Date.now()}.obj`);
    
    try {
      // Step 1: Convert to OBJ via APS
      await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
      
      // Step 2: Convert OBJ to final format
      await convertWithFullFallback(tempObjPath, outputPath);
      
      return {
        outputPath,
        tool: 'pipeline', // APS + Blender/Assimp
        duration: Date.now() - startTime
      };
    } catch (err) {
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
    console.log(`[ConversionService] Converting ${inputFormat.toUpperCase()} → DXF via Blender...`);
    try {
      await blenderConvert(inputPath, outputPath);
      return {
        outputPath,
        tool: 'blender',
        duration: Date.now() - startTime
      };
    } catch (blenderErr) {
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
    console.log(`[ConversionService] Simple mesh conversion: ${inputFormat} → ${normalizedOutputFormat}`);
    
    tool = await convertWithFullFallback(inputPath, outputPath);
    
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
    console.log(`[ConversionService] CAD format detected, trying Blender first...`);
    
    try {
      await blenderConvert(inputPath, outputPath);
      return {
        outputPath,
        tool: 'blender',
        duration: Date.now() - startTime
      };
    } catch (blenderErr) {
      console.log(`[ConversionService] Blender failed, trying FreeCAD...`);
      
      // Cast for flexible comparison
      const outFmt = normalizedOutputFormat as string;
      
      if (canFreecadHandle(inputFormat)) {
        const tempStlPath = path.join(inputDir, `temp_${Date.now()}.stl`);
        try {
          const freecadResult = await convertWithFreecad(inputPath, 'stl');
          await fs.move(freecadResult.outputPath, tempStlPath, { overwrite: true });
          
          if (outFmt === 'stl') {
            await fs.move(tempStlPath, outputPath, { overwrite: true });
          } else {
            await convertWithFullFallback(tempStlPath, outputPath);
          }
          
          return {
            outputPath,
            tool: 'pipeline',
            duration: Date.now() - startTime
          };
        } catch (freecadErr) {
          console.log(`[ConversionService] FreeCAD failed, trying APS as last resort...`);
          
          // Try APS as ultimate fallback
          if (isApsAvailable()) {
            try {
              const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
              await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
              
              if (outFmt === 'obj') {
                await fs.move(tempObjPath, outputPath, { overwrite: true });
              } else {
                await convertWithFullFallback(tempObjPath, outputPath);
                await fs.remove(tempObjPath).catch(() => {});
              }
              
              return {
                outputPath,
                tool: 'aps',
                duration: Date.now() - startTime
              };
            } catch (apsErr) {
              console.log(`[ConversionService] APS also failed`);
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
        console.log(`[ConversionService] Trying APS directly...`);
        try {
          const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
          await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
          
          if (outFmt === 'obj') {
            await fs.move(tempObjPath, outputPath, { overwrite: true });
          } else {
            await convertWithFullFallback(tempObjPath, outputPath);
            await fs.remove(tempObjPath).catch(() => {});
          }
          
          return {
            outputPath,
            tool: 'aps',
            duration: Date.now() - startTime
          };
        } catch (apsErr) {
          console.log(`[ConversionService] APS also failed`);
        }
      }
      
      throw blenderErr;
    }
  }

  // =====================================================
  // 4. FALLBACK - Try full chain for any other formats
  // =====================================================
  console.log(`[ConversionService] Using full fallback chain...`);
  tool = await convertWithFullFallback(inputPath, outputPath);
  
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

  // 1. Try Assimp first (fast, good for simple meshes)
  if (isSimpleMesh(inputFormat) && isSimpleMesh(outputFormat)) {
    try {
      console.log(`[ConversionService] Trying Assimp...`);
      await assimpConvert(inputPath, outputPath);
      return 'assimp';
    } catch (err) {
      console.log(`[ConversionService] Assimp failed, trying Blender...`);
    }
  }

  // 2. Try Blender
  try {
    console.log(`[ConversionService] Trying Blender...`);
    await blenderConvert(inputPath, outputPath);
    return 'blender';
  } catch (err) {
    console.log(`[ConversionService] Blender failed, trying FreeCAD...`);
  }

  // 3. Try FreeCAD
  if (canFreecadHandle(inputFormat)) {
    const tempStlPath = path.join(inputDir, `temp_freecad_${Date.now()}.stl`);
    try {
      console.log(`[ConversionService] Trying FreeCAD...`);
      const freecadResult = await convertWithFreecad(inputPath, 'stl');
      await fs.move(freecadResult.outputPath, tempStlPath, { overwrite: true });
      
      if (outputFormat === 'stl') {
        await fs.move(tempStlPath, outputPath, { overwrite: true });
      } else {
        // Convert STL to final format via Blender
        await blenderConvert(tempStlPath, outputPath);
      }
      return 'pipeline';
    } catch (err) {
      console.log(`[ConversionService] FreeCAD failed, trying APS...`);
    } finally {
      await fs.remove(tempStlPath).catch(() => {});
    }
  }

  // 4. Try APS as ultimate fallback
  if (isApsAvailable()) {
    const tempObjPath = path.join(inputDir, `temp_aps_${Date.now()}.obj`);
    try {
      console.log(`[ConversionService] Trying APS as last resort...`);
      await apsConvert(inputPath, tempObjPath, { outputFormat: 'obj' });
      
      if (outputFormat === 'obj') {
        await fs.move(tempObjPath, outputPath, { overwrite: true });
      } else {
        await blenderConvert(tempObjPath, outputPath);
        await fs.remove(tempObjPath).catch(() => {});
      }
      return 'aps';
    } catch (err) {
      console.log(`[ConversionService] APS also failed`);
      await fs.remove(tempObjPath).catch(() => {});
    }
  }

  // All methods failed
  throw new ConversionError(
    `Failed to convert ${inputFormat.toUpperCase()} to ${outputFormat.toUpperCase()}`,
    'All conversion methods failed (Assimp, Blender, FreeCAD, APS). ' +
    'The file may be corrupted or in an unsupported format.'
  );
}