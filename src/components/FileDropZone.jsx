import { useRef, useState } from "react";
import { DOCUMENT_LIMITS } from "../services/documentIntelligence";
import { Icons, renderIcon } from "./icons";
import { Button } from "./ui";

export default function FileDropZone({
  title = "Upload files",
  label,
  subtitle = "Drop files here or browse from your device.",
  description,
  onFiles,
  accept = ".pdf,.png,.jpg,.jpeg,.docx,.txt,.md",
  loading = false,
  progress = 0,
  small = false,
  className = "",
  style,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    onFiles?.(files);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const heading = label || title;
  const body = description || subtitle;

  return (
    <div
      className={`file-drop-zone ${dragging ? "dragging" : ""} ${small ? "small" : ""} ${className}`.trim()}
      style={style}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input ref={inputRef} type="file" accept={accept} hidden multiple onChange={(event) => handleFiles(event.target.files)} />
      <div className="file-drop-icon">{renderIcon(Icons.upload || Icons.download, 22)}</div>
      <div className="b sm">{heading}</div>
      <div className="xs ct3" style={{ marginTop: 4, lineHeight: 1.6 }}>
        {body}
      </div>
      <div className="xs ct3" style={{ marginTop: 6 }}>
        Max {Math.round(DOCUMENT_LIMITS.maxFileSize / 1024 / 1024)}MB · PDF, PNG, JPG, DOCX, TXT, MD
      </div>
      {loading ? (
        <div className="upload-progress">
          <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      ) : (
        <Button small tone="bt-p" onClick={() => inputRef.current?.click()} style={{ marginTop: 10 }}>
          Browse Files
        </Button>
      )}
    </div>
  );
}
