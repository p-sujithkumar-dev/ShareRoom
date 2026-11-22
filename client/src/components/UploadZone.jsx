import { useRef, useState } from "react";

import {
  UploadCloud,
  FolderOpen,
  File,
  CheckCircle,
  XCircle,
  Clock,
  LoaderCircle,
} from "lucide-react";

function formatSize(bytes) {
  if (!bytes) return "0 Bytes";

  const sizes = ["Bytes", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  return (bytes / Math.pow(1024, index)).toFixed(2) + " " + sizes[index];
}

export default function UploadZone({
  onUpload,
  uploading,
  progress,
  uploadItems = [],
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files) => {
    if (!files || files.length === 0 || uploading) return;

    onUpload(Array.from(files));

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const completedCount = uploadItems.filter(
    (item) => item.status === "Completed",
  ).length;

  const failedCount = uploadItems.filter(
    (item) => item.status === "Failed",
  ).length;

  const getStatusIcon = (status) => {
    switch (status) {
      case "Completed":
        return <CheckCircle size={17} />;

      case "Failed":
        return <XCircle size={17} />;

      case "Uploading":
        return <LoaderCircle size={17} className="upload-spinner" />;

      default:
        return <Clock size={17} />;
    }
  };

  return (
    <div
      className={`upload-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        disabled={uploading}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="upload-icon">
        <UploadCloud size={35} />
      </div>

      <h3>Drag & Drop your files here</h3>

      <p>Share documents, images, videos and other files</p>

      <button
        className="browse-button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        type="button"
      >
        <FolderOpen size={17} />
        Browse Files
      </button>

      <span className="upload-limit">Maximum file size: 500 MB per file</span>

      {/* UPLOAD DASHBOARD */}
      {uploadItems.length > 0 && (
        <div className="upload-dashboard">
          <div className="upload-dashboard-header">
            <div>
              <h3>Upload Progress</h3>
              <p>
                {completedCount} of {uploadItems.length} files completed
              </p>
            </div>

            <span className="upload-total-percent">{progress}%</span>
          </div>

          <div className="upload-total-track">
            <div
              className="upload-total-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="upload-summary">
            <span>
              <CheckCircle size={14} />
              {completedCount} Completed
            </span>

            <span>
              <XCircle size={14} />
              {failedCount} Failed
            </span>

            <span>
              <File size={14} />
              {uploadItems.length} Total
            </span>
          </div>

          <div className="upload-file-list">
            {uploadItems.map((item) => (
              <div className="upload-file-item" key={item.id}>
                <div className="upload-file-top">
                  <div className="upload-file-name">
                    <File size={18} />

                    <span title={item.name}>{item.name}</span>
                  </div>

                  <div className={`upload-status ${item.status.toLowerCase()}`}>
                    {getStatusIcon(item.status)}
                    <span>{item.status}</span>
                  </div>
                </div>

                <div className="upload-file-bottom">
                  <div className="upload-file-track">
                    <div
                      className={`upload-file-fill ${item.status.toLowerCase()}`}
                      style={{
                        width: `${item.progress}%`,
                      }}
                    />
                  </div>

                  <span className="upload-file-percent">
                    {item.status === "Failed" ? "Failed" : `${item.progress}%`}
                  </span>
                </div>

                <span className="upload-file-size">
                  {formatSize(item.size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
