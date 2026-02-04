# 3D File Converter

A powerful 3D file conversion service with support for CAD formats (DWG, DXF) and mesh formats (OBJ, STL, FBX, GLTF, etc.).

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                       │
│                         http://localhost:8080                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend (Fastify + TypeScript)                    │
│                         http://localhost:3001                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Conversion Service                        │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐   │    │
│  │  │ Blender │  │ Assimp  │  │ FreeCAD │  │ Autodesk APS │   │    │
│  │  │  4.0.2  │  │  5.3.1  │  │  0.21   │  │    (Cloud)   │   │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └──────────────┘   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## 📊 Conversion Workflows

The backend implements a **smart routing system** that automatically selects the best conversion tool with full fallback chains. This ensures **ANY format can be converted to ANY format**.

---

### 1. DWG/DXF Files (Input OR Output) → Autodesk APS

**When triggered:** If the uploaded file is DWG/DXF OR the target format is DXF

**Technology:** Autodesk APS (Platform Services) Cloud API

AutoCAD files contain ACIS 3D solids (proprietary geometry) that only Autodesk can read properly.

#### ⚠️ APS Output Format Limitations

Autodesk APS Model Derivative API can **only export to these formats**:
| Supported | Not Supported |
|-----------|---------------|
| ✅ OBJ | ❌ FBX |
| ✅ STL | ❌ GLTF / GLB |
| ✅ STEP | ❌ PLY |
| ✅ IGES | ❌ 3DS |
| | ❌ DXF (ironically!) |
| | ❌ DWG |

**This is why we use OBJ as an intermediate format** - APS converts DWG/DXF to OBJ, then Blender converts OBJ to the final format (FBX, GLTF, etc.)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DWG/DXF INPUT Detected                           │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        Autodesk APS Cloud                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │  Upload  │───▶│   SVF2   │───▶│   OBJ    │───▶│ Download │           │
│  │  to OSS  │    │  Transl. │    │ Extract  │    │  Result  │           │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘           │
│                                                                          │
│  NOTE: APS can only output OBJ/STL - not FBX, GLTF, etc.                │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            ┌──────────────┐               ┌───────────────────────┐
            │  OBJ / STL   │               │  Other format needed? │
            │   (Direct)   │               │  (FBX, GLTF, GLB...)  │
            └──────────────┘               └───────────────────────┘
                                                    │
                                                    ▼
                                           ┌──────────────┐
                                           │   Blender    │
                                           │  OBJ → FBX   │
                                           │  OBJ → GLTF  │
                                           └──────────────┘
```

#### DXF Output (from mesh files)

For converting **mesh → DXF**, Blender handles this directly (no APS needed):
```
OBJ/STL/FBX → Blender → DXF ✅
```

#### DWG Output - Not Supported

DWG is a **proprietary format** that requires AutoCAD. Neither APS nor any open-source tool can create DWG files.

**Examples:**
| Conversion | How it works |
|------------|--------------|
| `model.dwg` → `model.obj` | APS direct ✅ |
| `model.dxf` → `model.stl` | APS direct ✅ |
| `model.dwg` → `model.fbx` | APS → OBJ → Blender → FBX ✅ |
| `model.dwg` → `model.gltf` | APS → OBJ → Blender → GLTF ✅ |
| `model.obj` → `model.dxf` | Blender direct ✅ |
| `model.fbx` → `model.dxf` | Blender direct ✅ |
| `model.obj` → `model.dwg` | ❌ Not possible (proprietary) |
| `model.dxf` → `model.dwg` | ❌ Not possible (use AutoCAD) |

---

### 2. Simple Mesh → Simple Mesh (Full Fallback Chain)

**When triggered:** Both input and output are mesh formats (OBJ, STL, FBX, PLY, GLTF, GLB, 3DS, DAE)

**Fallback Chain:** Assimp → Blender → FreeCAD → APS

```
┌──────────────┐
│  Input Mesh  │
│ (OBJ, STL,   │
│  FBX, etc.)  │
└──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Assimp     │────▶│   Blender    │────▶│   FreeCAD    │────▶│     APS      │
│   (Fast)     │ fail│   4.0.2      │ fail│    0.21      │ fail│   (Cloud)    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │                    │
       │ success            │ success            │ success            │ success
       ▼                    ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Output Mesh                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Examples:**
- `model.obj` → `model.stl` ✅ (Usually Assimp)
- `model.fbx` → `model.gltf` ✅ (Usually Blender)
- `model.ply` → `model.glb` ✅ (Assimp or Blender)

---

### 3. CAD/Complex Formats (Full Fallback Chain)

**When triggered:** Input or output is a CAD format (not DWG/DXF)

**Fallback Chain:** Blender → FreeCAD → APS

```
┌──────────────┐
│  CAD Input   │
│ (STEP, IGES, │
│  etc.)       │
└──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Blender    │────▶│   FreeCAD    │────▶│     APS      │
│   4.0.2      │ fail│    0.21      │ fail│   (Cloud)    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │ success            │ success            │ success
       ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Output (Mesh)                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Complete Decision Flowchart

This flowchart shows **every possible conversion path** in the system. The backend evaluates conditions in order (1→6) and takes the first matching path.

```
                              ┌─────────────────────────────────────┐
                              │           FILE UPLOADED             │
                              │     (input format detected)         │
                              └─────────────────────────────────────┘
                                              │
                                              ▼
                              ┌─────────────────────────────────────┐
                              │   User selects OUTPUT FORMAT        │
                              └─────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CHECK 1: Is this DXF ↔ DWG swap?                                                       │
│  (input=DXF & output=DWG) OR (input=DWG & output=DXF)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
            │ YES                                                        │ NO
            ▼                                                            ▼
┌───────────────────────┐               ┌─────────────────────────────────────────────────┐
│     ODA FILE          │               │  CHECK 2: Is output = DWG (and input ≠ DXF)?    │
│     CONVERTER         │               │  (Any mesh/CAD → DWG)                           │
│  ─────────────────    │               └─────────────────────────────────────────────────┘
│  DXF → DWG directly   │                         │ YES                          │ NO
│  DWG → DXF directly   │                         ▼                              ▼
└───────────────────────┘               ┌───────────────────────┐  ┌──────────────────────┐
            │                           │  PIPELINE: Blender +  │  │  CHECK 3: Is input   │
            ▼                           │  ODA                  │  │  DWG or DXF?         │
      ✅ DONE                           │  ─────────────────    │  └──────────────────────┘
                                        │  Step 1: Any → DXF    │        │ YES        │ NO
                                        │  (Blender)            │        ▼            ▼
                                        │  Step 2: DXF → DWG    │  ┌────────────┐ ┌───────┐
                                        │  (ODA)                │  │   APS      │ │  (4)  │
                                        └───────────────────────┘  │  CLOUD     │ └───────┘
                                                    │              └────────────┘
                                                    ▼                    │
                                              ✅ DONE                    ▼
                                                            ┌─────────────────────────────┐
                                                            │ Is output OBJ or STL?       │
                                                            └─────────────────────────────┘
                                                                  │ YES           │ NO
                                                                  ▼               ▼
                                                            ┌─────────┐   ┌───────────────┐
                                                            │ APS     │   │ APS → OBJ →   │
                                                            │ Direct  │   │ Blender/Assimp│
                                                            │ Output  │   │ → Target      │
                                                            └─────────┘   └───────────────┘
                                                                  │               │
                                                                  ▼               ▼
                                                            ✅ DONE         ✅ DONE
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  (Continued from CHECK 3 = NO)                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CHECK 4: Is output = DXF?                                                              │
│  (Any mesh/CAD → DXF)                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
            │ YES                                                        │ NO
            ▼                                                            ▼
┌───────────────────────┐               ┌─────────────────────────────────────────────────┐
│      BLENDER          │               │  CHECK 5: Is input AND output SIMPLE MESH?      │
│  ─────────────────    │               │  Simple = OBJ, STL, FBX, PLY, GLTF, GLB, 3DS,   │
│  Any → DXF directly   │               │           DAE                                   │
│  (Blender export)     │               └─────────────────────────────────────────────────┘
└───────────────────────┘                         │ YES                          │ NO
            │                                     ▼                              ▼
            ▼                     ┌─────────────────────────────┐  ┌──────────────────────┐
      ✅ DONE                     │  FALLBACK CHAIN:            │  │  CHECK 6: Is input   │
                                  │  Assimp → Blender →         │  │  OR output a CAD     │
                                  │  FreeCAD → APS              │  │  format?             │
                                  └─────────────────────────────┘  │  CAD = STEP, IGES,   │
                                              │                    │        etc.          │
                                              ▼                    └──────────────────────┘
                                  ┌─────────────────────────────┐        │ YES        │ NO
                                  │  TRY ASSIMP (fastest)       │        ▼            ▼
                                  └─────────────────────────────┘  ┌────────────┐ ┌───────┐
                                       │ ✓ OK      │ ✗ FAIL        │ FALLBACK   │ │ ERROR │
                                       ▼           ▼               │ CHAIN:     │ │ Unsup │
                                  ✅ DONE    ┌─────────────┐       │ Blender →  │ │ ported│
                                             │ TRY BLENDER │       │ FreeCAD →  │ └───────┘
                                             └─────────────┘       │ APS        │
                                              │ ✓ OK  │ ✗ FAIL     └────────────┘
                                              ▼       ▼                  │
                                         ✅ DONE  ┌─────────────┐        ▼
                                                  │TRY FREECAD  │  (see below)
                                                  └─────────────┘
                                                   │ ✓ OK  │ ✗ FAIL
                                                   ▼       ▼
                                              ✅ DONE  ┌───────────┐
                                                       │ TRY APS   │
                                                       │ (cloud)   │
                                                       └───────────┘
                                                        │ ✓ OK  │ ✗ FAIL
                                                        ▼       ▼
                                                   ✅ DONE   ❌ ERROR
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAD FORMAT FALLBACK CHAIN (from CHECK 6 = YES)                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────────┐
                              │       TRY BLENDER             │
                              │   (supports many CAD via      │
                              │    import add-ons)            │
                              └───────────────────────────────┘
                                   │ ✓ OK          │ ✗ FAIL
                                   ▼               ▼
                              ✅ DONE      ┌───────────────────┐
                                           │  Can FreeCAD      │
                                           │  handle input?    │
                                           └───────────────────┘
                                                │ YES      │ NO
                                                ▼          ▼
                                    ┌───────────────┐  ┌──────────────┐
                                    │ TRY FREECAD   │  │ Is APS       │
                                    │ → STL → final │  │ available?   │
                                    └───────────────┘  └──────────────┘
                                     │ ✓ OK  │ ✗ FAIL      │ YES   │ NO
                                     ▼       ▼             ▼       ▼
                                ✅ DONE  ┌────────────┐ ┌──────┐ ❌ ERROR
                                         │ Is APS    │ │ APS  │
                                         │available? │ │→ OBJ │
                                         └────────────┘ │→final│
                                          │ YES  │ NO   └──────┘
                                          ▼      ▼         │
                                     ┌──────┐ ❌ ERROR ✅ DONE
                                     │ APS  │
                                     │→ OBJ │
                                     │→final│
                                     └──────┘
                                          │
                                          ▼
                                     ✅ DONE
```

---

### 📊 Quick Reference: Conversion Decision Table

| Input | Output | Path Taken | Tools Used |
|-------|--------|------------|------------|
| **DXF** | **DWG** | Check 1 | ODA directly |
| **DWG** | **DXF** | Check 1 | ODA directly |
| **OBJ** | **DWG** | Check 2 | Blender → DXF → ODA |
| **FBX** | **DWG** | Check 2 | Blender → DXF → ODA |
| **GLTF** | **DWG** | Check 2 | Blender → DXF → ODA |
| **STL** | **DWG** | Check 2 | Blender → DXF → ODA |
| **DWG** | **OBJ** | Check 3 | APS direct |
| **DWG** | **STL** | Check 3 | APS direct |
| **DWG** | **FBX** | Check 3 | APS → OBJ → Blender |
| **DWG** | **GLTF** | Check 3 | APS → OBJ → Blender |
| **DXF** | **OBJ** | Check 3 | APS direct |
| **DXF** | **FBX** | Check 3 | APS → OBJ → Blender |
| **OBJ** | **DXF** | Check 4 | Blender directly |
| **FBX** | **DXF** | Check 4 | Blender directly |
| **STL** | **DXF** | Check 4 | Blender directly |
| **OBJ** | **STL** | Check 5 | Assimp (fast) |
| **FBX** | **GLTF** | Check 5 | Assimp → Blender fallback |
| **STL** | **GLB** | Check 5 | Assimp → Blender fallback |
| **STEP** | **OBJ** | Check 6 | Blender → FreeCAD → APS |
| **IGES** | **STL** | Check 6 | Blender → FreeCAD → APS |

---

### 🔑 Key Points

| Feature | Description |
|---------|-------------|
| ✅ **DXF ↔ DWG uses ODA** | Direct conversion between AutoCAD formats |
| ✅ **Any → DWG via pipeline** | Blender creates DXF, then ODA converts to DWG |
| ✅ **DWG/DXF input uses APS** | Only Autodesk can read ACIS 3D solids properly |
| ✅ **Any → DXF via Blender** | Blender exports mesh geometry to DXF |
| ✅ **Every path has fallbacks** | No single point of failure |
| ✅ **APS is ultimate fallback** | Cloud-based, handles most formats |
| ✅ **ANY → ANY is possible** | Through intermediate formats if needed |

---

## 🔧 Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | React + Vite + Nginx | Web UI for file upload/download |
| **Backend** | Fastify + TypeScript | API server, request handling |
| **Blender 4.0.2** | Open-source 3D software | Mesh conversion, CAD import |
| **Assimp 5.3.1** | Asset Import Library | Fast mesh-to-mesh conversion |
| **FreeCAD 0.21** | Open-source CAD | CAD format fallback |
| **Autodesk APS** | Cloud API | DWG/DXF with ACIS 3D solids |
| **Docker** | Containerization | Consistent runtime environment |

---

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd 3d-file-converter

# Configure environment (optional - for DWG/DXF support)
# Add to docker-compose.yml environment section:
# - APS_CLIENT_ID=your_client_id
# - APS_CLIENT_SECRET=your_client_secret

# Build and start
docker compose build
docker compose up -d

# Access the application
# Frontend: http://localhost:8080
# Backend API: http://localhost:3001
```

### Manual Setup

```bash
# Install dependencies
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Build
npm run build

# Start
npm start
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness probe |
| `GET` | `/info` | Server information |
| `GET` | `/metrics` | Memory & system metrics |
| `GET` | `/api/formats` | List supported formats |
| `POST` | `/api/convert` | Convert a 3D file |
| `GET` | `/api/download/:filename` | Download converted file |
| `POST` | `/api/cleanup` | Trigger manual cleanup |

### Convert a File

```bash
curl -X POST "http://localhost:3001/api/convert" \
  -F "file=@model.dwg" \
  -F "format=obj"

# Response:
# {
#   "message": "Conversion successful",
#   "downloadUrl": "/api/download/123456.obj",
#   "tool": "aps",
#   "duration": 65000
# }
```

---

## 📋 Supported Formats

### Input Formats
| Format | Extension | Type | Converter |
|--------|-----------|------|-----------|
| AutoCAD Drawing | `.dwg` | CAD | Autodesk APS |
| Drawing Exchange | `.dxf` | CAD | Autodesk APS |
| Wavefront OBJ | `.obj` | Mesh | Assimp/Blender |
| Stereolithography | `.stl` | Mesh | Assimp/Blender |
| Autodesk FBX | `.fbx` | Mesh | Assimp/Blender |
| Stanford PLY | `.ply` | Mesh | Assimp/Blender |
| COLLADA | `.dae` | Mesh | Assimp/Blender |
| 3D Studio | `.3ds` | Mesh | Assimp/Blender |
| glTF | `.gltf`, `.glb` | Mesh | Assimp/Blender |

### Output Formats
| Format | Extension | Type |
|--------|-----------|------|
| Wavefront OBJ | `.obj` | Mesh |
| Stereolithography | `.stl` | Mesh |
| Autodesk FBX | `.fbx` | Mesh |
| Stanford PLY | `.ply` | Mesh |
| glTF Text | `.gltf` | Mesh |
| glTF Binary | `.glb` | Mesh |
| Drawing Exchange | `.dxf` | CAD (from mesh only) |

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `MAX_CONCURRENT_BLENDER` | `2` | Max parallel Blender jobs |
| `MAX_CONCURRENT_ASSIMP` | `5` | Max parallel Assimp jobs |
| `CONVERSION_TIMEOUT` | `300000` | Timeout in ms (5 min) |
| `APS_CLIENT_ID` | - | **Required for DWG/DXF** - Autodesk APS client ID |
| `APS_CLIENT_SECRET` | - | **Required for DWG/DXF** - Autodesk APS client secret |
| `APS_BUCKET_KEY` | `tecnibo_3d_converter` | Autodesk OSS bucket name |

---

## 🔧 Backend Complexity

The conversion service implements a **sophisticated routing algorithm** that:

1. **Detects format type** (DWG/DXF, simple mesh, CAD)
2. **Selects optimal tool** based on format combination
3. **Implements full fallback chains** to maximize success rate
4. **Uses intermediate formats** when direct conversion isn't possible
5. **Cleans up temporary files** after conversion

```typescript
// Simplified decision logic
if (input is DWG/DXF || output is DWG/DXF) {
  → Use Autodesk APS (cloud)
} else if (input is SimpleMesh && output is SimpleMesh) {
  → Try: Assimp → Blender → FreeCAD → APS
} else {
  → Try: Blender → FreeCAD → APS
}
```

This design ensures:
- ✅ **Maximum compatibility** - If one tool fails, others are tried
- ✅ **Optimal performance** - Fast tools (Assimp) are tried first
- ✅ **ACIS solid support** - DWG/DXF always route to Autodesk
- ✅ **ANY → ANY conversion** - Through intermediate formats if needed

---

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🔗 Resources

- [Blender Python API](https://docs.blender.org/api/current/)
- [Assimp Documentation](https://assimp-docs.readthedocs.io/)
- [FreeCAD Documentation](https://wiki.freecad.org/)
- [Autodesk APS Documentation](https://aps.autodesk.com/developer/documentation)
