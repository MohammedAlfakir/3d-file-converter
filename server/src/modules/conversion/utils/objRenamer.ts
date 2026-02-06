/**
 * OBJ Name Rehydration Utility
 * 
 * When APS converts DWG/DXF to OBJ, it uses patterns like "g Obj.XXX"
 * where XXX is a hexadecimal ID. This utility maps those IDs to readable names
 * from the APS metadata.
 * 
 * The metadata contains object names with hex IDs in brackets:
 * - "Solid [10A]" → hex ID is 10A
 * - "TL0151_Inox [32D]" → hex ID is 32D
 * 
 * OBJ file uses: "g Obj.10A" format
 * 
 * Flow:
 * 1. Build a lookup map from APS object tree (hexId → name)
 * 2. Stream through OBJ file, replacing "g Obj.10A" with "g Solid_10A"
 * 3. Write the cleaned OBJ file
 */

import fs from 'fs';
import readline from 'readline';

/**
 * Interface for APS object tree node
 */
export interface ApsObjectNode {
  objectid: number;
  name: string;
  objects?: ApsObjectNode[];
}

/**
 * Interface for APS object tree response
 */
export interface ApsObjectTree {
  data?: {
    type: string;
    objects: ApsObjectNode[];
  };
}

/**
 * Build a flat map of ID → cleanName from the APS object tree
 * 
 * APS OBJ files use objectId values (decimal) like "g Obj.148" that reference
 * the objects in the metadata tree. We need to map these IDs to readable names.
 * 
 * @param objectTree The APS object tree response
 * @returns Map of ID (string) to cleaned name
 */
export function buildIdToNameMap(objectTree: ApsObjectTree): Map<string, string> {
  const idToNameMap = new Map<string, string>();
  
  function recurse(objects: ApsObjectNode[]) {
    for (const obj of objects) {
      // Get the raw name
      const rawName = obj.name || 'Unnamed';
      
      // Check if name has a hex ID in brackets like "Solid [10A]"
      const hexMatch = rawName.match(/\[([0-9A-Fa-f]+)\]$/);
      
      let displayName: string;
      if (hexMatch) {
        // Remove the hex ID suffix for cleaner display
        const nameWithoutHex = rawName.replace(/\s*\[[0-9A-Fa-f]+\]$/, '');
        displayName = nameWithoutHex;
      } else {
        displayName = rawName;
      }
      
      // Clean the name: Remove special chars that break OBJ format
      // Keep alphanumeric, underscores, and hyphens only
      const cleanName = displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      // Create a unique name by appending the objectid
      const uniqueName = `${cleanName}_${obj.objectid}`;
      
      // ALWAYS store by decimal objectid (this is what OBJ files use)
      const decimalId = String(obj.objectid);
      idToNameMap.set(decimalId, uniqueName);
      
      // Also store by the hex equivalent of objectid (fallback)
      const hexOfObjectId = obj.objectid.toString(16).toUpperCase();
      if (!idToNameMap.has(hexOfObjectId)) {
        idToNameMap.set(hexOfObjectId, uniqueName);
      }
      
      // If there was a hex ID in brackets, also store by that
      if (hexMatch) {
        const bracketHexId = hexMatch[1].toUpperCase();
        if (!idToNameMap.has(bracketHexId)) {
          idToNameMap.set(bracketHexId, uniqueName);
        }
      }
      
      // Recurse into children
      if (obj.objects && obj.objects.length > 0) {
        recurse(obj.objects);
      }
    }
  }
  
  if (objectTree.data?.objects) {
    recurse(objectTree.data.objects);
  }
  
  return idToNameMap;
}

/**
 * Rehydrate OBJ file names from APS metadata
 * 
 * Replaces generic APS IDs with readable names from metadata.
 * 
 * @param objFilePath Path to the raw OBJ file from APS (e.g., with 'g 212')
 * @param objectTree The Object Tree fetched from APS API
 * @param outputFilePath Path to save the fixed OBJ
 */
export async function rehydrateObjNames(
  objFilePath: string,
  objectTree: ApsObjectTree,
  outputFilePath: string
): Promise<{ totalReplaced: number; totalGroups: number }> {
  console.log('[OBJ Renamer] Starting name rehydration...');
  
  // 1. Build the ID → Name lookup map
  const idToNameMap = buildIdToNameMap(objectTree);
  console.log(`[OBJ Renamer] Built lookup map with ${idToNameMap.size} entries`);
  
  // Log a sample of the mappings for debugging
  let sampleCount = 0;
  for (const [id, name] of idToNameMap) {
    if (sampleCount < 10) {
      console.log(`[OBJ Renamer] Sample: ${id} → ${name}`);
      sampleCount++;
    } else {
      break;
    }
  }
  
  // 2. Stream read the OBJ file (memory efficient for large files)
  const fileStream = fs.createReadStream(objFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const outputStream = fs.createWriteStream(outputFilePath);
  
  let totalReplaced = 0;
  let totalGroups = 0;
  
  for await (const line of rl) {
    // Check if line is an Object/Group definition
    // APS uses patterns like:
    // 1. "g Obj.148" - Where 148 is a decimal objectId
    // 2. "g Obj.148:1" - With instance suffix
    // 3. "g 212" or "g 212:1" - Simple numeric ID (legacy)
    
    // Pattern 1: "g Obj.XXX" or "g Obj.XXX:Y" where XXX is numeric ID
    const objMatch = line.match(/^([go])\s+Obj\.([0-9A-Fa-f]+)(:\d+)?$/);
    
    if (objMatch) {
      totalGroups++;
      const prefix = objMatch[1]; // 'g' or 'o'
      const objId = objMatch[2];  // '148' (usually decimal objectId)
      const suffix = objMatch[3] || ''; // ':1' or ''
      
      // Try to find name by the ID (check both as-is and uppercase for hex compatibility)
      let realName = idToNameMap.get(objId) || idToNameMap.get(objId.toUpperCase());
      
      if (realName) {
        // Replace "g Obj.148:1" with "g 3_5x13_Autof_TB_Grey_148_1"
        const cleanSuffix = suffix.replace(':', '_');
        const newLine = `${prefix} ${realName}${cleanSuffix}`;
        outputStream.write(`${newLine}\n`);
        totalReplaced++;
        
        // Log first few replacements for debugging
        if (totalReplaced <= 5) {
          console.log(`[OBJ Renamer] Replaced: "${line}" → "${newLine}"`);
        }
      } else {
        // ID not found in metadata, keep original
        outputStream.write(`${line}\n`);
        if (totalGroups <= 5) {
          console.log(`[OBJ Renamer] No mapping for ID: ${objId}`);
        }
      }
      continue;
    }
    
    // Pattern 2: Legacy format "g 212" or "g 212:1"
    const legacyMatch = line.match(/^([go])\s+(\d+)(:\d+)?$/);
    
    if (legacyMatch) {
      totalGroups++;
      const prefix = legacyMatch[1]; // 'g' or 'o'
      const dbId = legacyMatch[2];   // '212'
      const suffix = legacyMatch[3] || ''; // ':1' or ''
      
      const realName = idToNameMap.get(dbId);
      
      if (realName) {
        // Replace "g 212:1" with "g Basic_Wall_212_1"
        const cleanSuffix = suffix.replace(':', '_');
        const newLine = `${prefix} ${realName}${cleanSuffix}`;
        outputStream.write(`${newLine}\n`);
        totalReplaced++;
        
        // Log first few replacements for debugging
        if (totalReplaced <= 5) {
          console.log(`[OBJ Renamer] Replaced: "${line}" → "${newLine}"`);
        }
      } else {
        // ID not found in metadata, keep original
        outputStream.write(`${line}\n`);
      }
      continue;
    }
    
    // Not a name line, just geometry (v, vt, vn, f, etc.)
    outputStream.write(`${line}\n`);
  }
  
  // Close the output stream
  outputStream.end();
  
  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });
  
  console.log(`[OBJ Renamer] ✅ Rehydration complete:`);
  console.log(`[OBJ Renamer]    - Total groups found: ${totalGroups}`);
  console.log(`[OBJ Renamer]    - Names replaced: ${totalReplaced}`);
  console.log(`[OBJ Renamer]    - Output: ${outputFilePath}`);
  
  return { totalReplaced, totalGroups };
}
