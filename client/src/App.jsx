import React, { useState, useEffect } from "react";

// API base URL - uses environment variable or defaults to same origin
const API_URL = import.meta.env.VITE_API_URL || "";

function App() {
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState("glb");
  const [status, setStatus] = useState("idle"); // idle, uploading, converting, success, error
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isExiting, setIsExiting] = useState(false);
  const [conversionInfo, setConversionInfo] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);

  // Fetch server info on app load
  useEffect(() => {
    fetch(`${API_URL}/info`)
      .then(res => res.json())
      .then(data => setServerInfo(data))
      .catch(err => console.error("Failed to fetch server info:", err));
  }, []);

  // Auto-dismiss toast notifications after 4 seconds
  useEffect(() => {
    if (status === "success" || status === "error") {
      setIsExiting(false);

      const exitTimer = setTimeout(() => {
        setIsExiting(true);
      }, 3700);

      const removeTimer = setTimeout(() => {
        setStatus("idle");
        setIsExiting(false);
      }, 4000);

      return () => {
        clearTimeout(exitTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [status]);

  const handleFileChange = e => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus("idle");
      setErrorMessage("");
      setDownloadUrl(null);
      setConversionInfo(null);
      setIsExiting(false);
    }
  };

  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setStatus("idle");
      setErrorMessage("");
      setDownloadUrl(null);
      setConversionInfo(null);
      setIsExiting(false);
    }
  };

  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleConvert = async () => {
    if (!file) {
      document.getElementById("fileInput").click();
      return;
    }

    setStatus("converting");
    setErrorMessage("");
    setConversionInfo(null);
    setIsExiting(false);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("format", format);
    
    // Debug: Log what we're sending
    console.log("Converting with format:", format);
    console.log("FormData format:", formData.get("format"));

    try {
      const response = await fetch(`${API_URL}/api/convert`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Conversion failed");
      }

      setDownloadUrl(`${API_URL}${data.downloadUrl}`);
      setConversionInfo({
        tool: data.tool,
        duration: data.duration,
      });
      setStatus("success");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setErrorMessage(error.message || "Conversion failed. Please try again.");
    }
  };

  const getToolBadge = (tool) => {
    const badges = {
      assimp: { label: "⚡ Assimp", color: "#10b981" },
      blender: { label: "🎨 Blender", color: "#3b82f6" },
      oda: { label: "📐 ODA", color: "#8b5cf6" },
      aps: { label: "☁️ APS", color: "#ec4899" },
      pipeline: { label: "🔗 Pipeline", color: "#f59e0b" },
    };
    return badges[tool] || { label: tool, color: "#6b7280" };
  };

  return (
    <div>
      {/* Toast Notifications */}
      <div className="toast-container">
        {status === "success" && (
          <div className={`toast toast-success ${isExiting ? "exit" : ""}`}>
            <div>
              <p className="toast-title">Conversion Successful!</p>
              <p className="toast-desc">
                {conversionInfo && (
                  <>
                    Converted in {conversionInfo.duration}ms using{" "}
                    <span style={{ 
                      background: getToolBadge(conversionInfo.tool).color,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      color: "white",
                      fontSize: "0.8rem"
                    }}>
                      {getToolBadge(conversionInfo.tool).label}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className={`toast toast-error ${isExiting ? "exit" : ""}`}>
            <div>
              <p className="toast-title">Conversion Failed</p>
              <p className="toast-desc">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>

      <h1 className="title">3D File Converter</h1>
      <p className="subtitle">
        Convert your 3D models to standard formats
      </p>

      <div className="glass-card">
        <div
          className={`drop-zone ${file ? "active" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById("fileInput").click()}
        >
          <input
            type="file"
            id="fileInput"
            style={{ display: "none" }}
            onChange={handleFileChange}
            accept=".obj,.stl,.fbx,.ply,.gltf,.glb,.dae,.3ds,.dxf,.dwg"
          />

          <div className="plus-icon-circle">+</div>

          {file ? (
            <div>
              <p className="drop-text" style={{ fontWeight: "bold" }}>
                {file.name}
              </p>
              <p className="drop-subtext">
                {(file.size / 1024 / 1024).toFixed(2)} MB • Ready to convert
              </p>
            </div>
          ) : (
            <div>
              <p className="drop-text">Drop files here</p>
              <p className="drop-subtext">
                OBJ, STL, FBX, PLY, GLTF, GLB, DAE, 3DS, DXF, DWG
              </p>
            </div>
          )}
        </div>

        {/* Control Bar: Format Left, Buttons Right */}
        <div className="control-bar">
          <div className="input-group">
            <label
              style={{
                color: "#40513B",
                fontWeight: "bold",
                fontSize: "0.9rem",
                margin: 0,
              }}
            >
              Target Format:
            </label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="select-format"
              onClick={e => e.stopPropagation()}
            >
              <optgroup label="Mesh Formats">
                <option value="glb">GLB (Binary glTF)</option>
                <option value="gltf">glTF (JSON)</option>
                <option value="obj">OBJ (Wavefront)</option>
                <option value="stl">STL (Stereolithography)</option>
                <option value="fbx">FBX (Autodesk)</option>
                <option value="ply">PLY (Stanford)</option>
                <option value="dae">DAE (Collada)</option>
                <option value="3ds">3DS (3D Studio)</option>
              </optgroup>
              <optgroup label="CAD Formats">
                <option value="dxf">DXF (Drawing Exchange)</option>
                <option value="dwg">DWG (AutoCAD)</option>
              </optgroup>
            </select>
          </div>

          <div className="btn-group">
            <button
              className="btn"
              onClick={handleConvert}
              disabled={!file || status === "converting"}
            >
              {status === "converting" ? (
                <span className="loader"></span>
              ) : null}
              {status === "converting" ? "Converting..." : "Convert Now"}
            </button>

            <a
              href={downloadUrl || "#"}
              className={`btn btn-download ${!downloadUrl ? "disabled" : ""}`}
              style={{
                pointerEvents: downloadUrl ? "auto" : "none",
                opacity: downloadUrl ? 1 : 0.6,
                textDecoration: "none",
              }}
              aria-disabled={!downloadUrl}
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
