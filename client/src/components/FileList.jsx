import { useMemo, useState } from "react";
import axios from "axios";

import {
  File,
  FileImage,
  FileVideo,
  FileText,
  FileArchive,
  Download,
  Eye,
  X,
  Search,
  SlidersHorizontal,
  Trash2,
  Loader2,
} from "lucide-react";

import { API_URL } from "../config";

function formatSize(bytes) {
  if (!bytes) return "0 Bytes";

  const sizes = ["Bytes", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  return (bytes / Math.pow(1024, index)).toFixed(2) + " " + sizes[index];
}

function getIcon(type) {
  if (type?.startsWith("image/")) return FileImage;
  if (type?.startsWith("video/")) return FileVideo;

  if (
    type?.includes("pdf") ||
    type?.startsWith("text/") ||
    type?.includes("document") ||
    type?.includes("word") ||
    type?.includes("spreadsheet") ||
    type?.includes("presentation")
  ) {
    return FileText;
  }

  if (
    type?.includes("zip") ||
    type?.includes("compressed") ||
    type?.includes("rar") ||
    type?.includes("7z") ||
    type?.includes("tar")
  ) {
    return FileArchive;
  }

  return File;
}

function getCategory(type) {
  if (type?.startsWith("image/")) return "images";
  if (type?.startsWith("video/")) return "videos";

  if (
    type?.includes("pdf") ||
    type?.startsWith("text/") ||
    type?.includes("document") ||
    type?.includes("word") ||
    type?.includes("spreadsheet") ||
    type?.includes("presentation") ||
    type?.includes("csv")
  ) {
    return "documents";
  }

  if (
    type?.includes("zip") ||
    type?.includes("compressed") ||
    type?.includes("rar") ||
    type?.includes("7z") ||
    type?.includes("tar")
  ) {
    return "archives";
  }

  return "others";
}

function isPreviewSupported(type) {
  return (
    (type?.startsWith("image/") &&
      [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/avif",
      ].includes(type)) ||
    type === "application/pdf" ||
    ["video/mp4", "video/webm", "video/ogg"].includes(type)
  );
}

export default function FileList({
  files = [],
  isHost = false,
  roomId,
  deviceId,
}) {
  const [previewFile, setPreviewFile] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // DELETE STATE

  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const closePreview = () => {
    setPreviewFile(null);
  };

  // DELETE FILE

  const handleDelete = async (item) => {
    if (!isHost) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${item.originalName}"?`,
    );

    if (!confirmDelete) return;

    try {
      setDeletingId(item._id);
      setDeleteError("");

      const response = await axios.delete(`${API_URL}/files/${item._id}`, {
        data: {
          roomId,
          deviceId,
        },
      });

      if (response.data.success) {
        if (previewFile?._id === item._id) {
          setPreviewFile(null);
        }

        // Socket event in App.jsx updates every connected device.
      }
    } catch (error) {
      console.error("Delete File Error:", error);

      setDeleteError(
        error.response?.data?.message ||
          "Unable to delete file. Please try again.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  // FILTER AND SORT

  const filteredFiles = useMemo(() => {
    let result = [...files];

    // Search
    if (search.trim()) {
      const keyword = search.toLowerCase().trim();

      result = result.filter(
        (item) =>
          item.originalName?.toLowerCase().includes(keyword) ||
          item.uploadedBy?.toLowerCase().includes(keyword),
      );
    }

    // Category filter
    if (category !== "all") {
      result = result.filter((item) => getCategory(item.mimeType) === category);
    }

    // Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0);

        case "name":
          return (a.originalName || "").localeCompare(b.originalName || "");

        case "size":
          return (b.size || 0) - (a.size || 0);

        case "newest":
        default:
          return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
      }
    });

    return result;
  }, [files, search, category, sortBy]);

  const categories = [
    { label: "All Files", value: "all" },
    { label: "Images", value: "images" },
    { label: "Videos", value: "videos" },
    { label: "Documents", value: "documents" },
    { label: "Archives", value: "archives" },
    { label: "Others", value: "others" },
  ];

  if (!files.length) {
    return (
      <div className="empty-files">
        <File size={35} />
        <h3>No files shared yet</h3>
        <p>Upload a file to start sharing.</p>
      </div>
    );
  }

  return (
    <>
      {/* FILE TOOLBAR */}

      <div className="file-toolbar">
        <div className="file-search">
          <Search size={19} />

          <input
            type="text"
            placeholder="Search files or uploader..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {search && (
            <button
              type="button"
              className="clear-search"
              onClick={() => setSearch("")}
              title="Clear search"
            >
              <X size={17} />
            </button>
          )}
        </div>

        <div className="file-filter-heading">
          <SlidersHorizontal size={17} />
          <span>Filter Files</span>
        </div>

        <div className="file-filter-row">
          {categories.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`file-filter-button ${
                category === item.value ? "active" : ""
              }`}
              onClick={() => setCategory(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="file-toolbar-bottom">
          <span className="file-count">
            Showing <strong>{filteredFiles.length}</strong> of{" "}
            <strong>{files.length}</strong> files
          </span>

          <select
            className="file-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Name (A-Z)</option>
            <option value="size">Largest First</option>
          </select>
        </div>
      </div>

      {/* DELETE ERROR */}

      {deleteError && (
        <div className="message-banner">
          <span>{deleteError}</span>

          <button type="button" onClick={() => setDeleteError("")}>
            ×
          </button>
        </div>
      )}

      {/* FILE LIST */}

      {filteredFiles.length > 0 ? (
        <div className="file-list">
          {filteredFiles.map((item) => {
            const Icon = getIcon(item.mimeType);

            const previewSupported = isPreviewSupported(item.mimeType);

            const isDeleting = deletingId === item._id;

            return (
              <div className="file-item" key={item._id}>
                <div className="file-icon">
                  <Icon size={22} />
                </div>

                <div className="file-info">
                  <h4 title={item.originalName}>{item.originalName}</h4>

                  <p>
                    {formatSize(item.size)}
                    {" · "}
                    {item.uploadedBy || "Unknown Device"}
                  </p>
                </div>

                <div className="file-actions">
                  {previewSupported && (
                    <button
                      className="preview-button"
                      onClick={() => setPreviewFile(item)}
                      title="Preview file"
                      type="button"
                    >
                      <Eye size={18} />
                    </button>
                  )}

                  <a
                    className="download-button"
                    href={`${API_URL}/files/download/${item._id}`}
                    title="Download file"
                  >
                    <Download size={19} />
                  </a>

                  {/* HOST ONLY DELETE BUTTON */}

                  {isHost && (
                    <button
                      className="delete-file-button"
                      onClick={() => handleDelete(item)}
                      disabled={isDeleting}
                      title="Delete file"
                      type="button"
                    >
                      {isDeleting ? (
                        <Loader2 size={18} className="delete-spinner" />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="no-filtered-files">
          <Search size={32} />
          <h3>No matching files found</h3>
          <p>Try another search or change the filter.</p>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setSortBy("newest");
            }}
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* FILE PREVIEW MODAL */}

      {previewFile && (
        <div className="preview-overlay" onClick={closePreview}>
          <div
            className="preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="preview-header">
              <div className="preview-title">
                <Eye size={19} />

                <h3 title={previewFile.originalName}>
                  {previewFile.originalName}
                </h3>
              </div>

              <button
                className="preview-close"
                onClick={closePreview}
                type="button"
                title="Close preview"
              >
                <X size={22} />
              </button>
            </div>

            <div className="preview-body">
              {previewFile.mimeType?.startsWith("image/") && (
                <img
                  src={`${API_URL}/files/preview/${previewFile._id}`}
                  alt={previewFile.originalName}
                  className="preview-image"
                />
              )}

              {previewFile.mimeType === "application/pdf" && (
                <iframe
                  src={`${API_URL}/files/preview/${previewFile._id}`}
                  title={previewFile.originalName}
                  className="preview-pdf"
                />
              )}

              {previewFile.mimeType?.startsWith("video/") && (
                <video
                  src={`${API_URL}/files/preview/${previewFile._id}`}
                  className="preview-video"
                  controls
                  autoPlay
                >
                  Your browser does not support video playback.
                </video>
              )}
            </div>

            <div className="preview-footer">
              <span>{formatSize(previewFile.size)}</span>

              <a
                className="preview-download"
                href={`${API_URL}/files/download/${previewFile._id}`}
              >
                <Download size={17} />
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
