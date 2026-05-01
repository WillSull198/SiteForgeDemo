/* SiteForge audit: Added shared, reusable photo upload with browser-side image
   compression, IndexedDB photo persistence, thumbnail previews, remove controls,
   and a lightbox. This replaces one-off broken image placeholders across modules. */

import { useRef, useState } from "react";
import { put } from "../services/db";
import { Icons, renderIcon } from "./icons";

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
      (Number(char) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4)))).toString(16),
    );
  }
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function assertStorageAvailable() {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 1 } = await navigator.storage.estimate();
  if (quota && usage / quota >= 0.9) {
    throw new Error("Storage is over 90% full. Export and clear old data before adding more photos.");
  }
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function captureCurrentLocation() {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: Date.now(),
          source: "device-location",
          embeddedLater: true,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4500, maximumAge: 60000 },
    );
  });
}

export async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const max = 1200;
  const scale = Math.min(max / bitmap.width, max / bitmap.height, 1);
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const toBlob = (quality) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  let quality = 0.82;
  let blob = await toBlob(quality);
  while (blob && blob.size > 500 * 1024 && quality > 0.54) {
    quality -= 0.08;
    blob = await toBlob(quality);
  }

  if (blob && blob.size > 500 * 1024) {
    const shrink = Math.max(0.55, Math.sqrt((500 * 1024) / blob.size));
    const nextWidth = Math.max(1, Math.round(canvas.width * shrink));
    const nextHeight = Math.max(1, Math.round(canvas.height * shrink));
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, nextWidth, nextHeight);
    blob = await toBlob(0.72);
  }

  bitmap.close?.();
  return blob;
}

export default function PhotoUpload({ onPhotosAdded, existingPhotos = [], onRemove, parentType = "record", parentId = null }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState("");

  const handleFiles = async (files) => {
    const incoming = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) return;
    setBusy(true);
    setError("");
    try {
      await assertStorageAvailable();
      const records = [];
      for (const file of incoming) {
        const compressed = await compressImage(file);
        if (!compressed) throw new Error(`Could not process ${file.name}.`);
        const dataUrl = await blobToDataUrl(compressed);
        const geo = await captureCurrentLocation();
        const record = await put("photos", {
          id: uuid(),
          filename: file.name,
          data: dataUrl,
          size: compressed.size,
          mimeType: "image/jpeg",
          parentType,
          parentId,
          geo,
          takenAt: file.lastModified || Date.now(),
          caption: "",
          createdAt: Date.now(),
        });
        records.push(record);
      }
      onPhotosAdded?.(records);
    } catch (err) {
      setError(err?.message || "Photo upload failed. Please try a smaller image.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      className={`photo-upload ${dragging ? "dragging" : ""}`.trim()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <div className="photo-grid">
        {existingPhotos.map((photo, index) => {
          const labelOnly = typeof photo === "string";
          const key = labelOnly ? `${photo}-${index}` : photo.id || photo.data || index;
          return (
            <button className="photo-thumb" key={key} type="button" onClick={() => !labelOnly && setLightbox(photo)}>
          {labelOnly ? (
                <span className="photo-label">{photo}</span>
              ) : (
                <img src={photo.data || photo.thumbnailDataUrl} alt={photo.caption || photo.filename || "Uploaded site photo"} />
              )}
              {!labelOnly && photo.geo ? <span className="photo-geo">GPS</span> : null}
              {onRemove && !labelOnly ? (
                <span
                  className="photo-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(photo.id);
                  }}
                >
                  {renderIcon(Icons.x, 11)}
                </span>
              ) : null}
            </button>
          );
        })}
        <label className="photo-add-btn">
          <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple onChange={(event) => handleFiles(event.target.files)} />
          {renderIcon(Icons.camera, 16)}
          <span>{busy ? "Processing..." : "Add Photo"}</span>
        </label>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {lightbox ? (
        <div className="photo-lightbox" onClick={() => setLightbox(null)}>
          <button className="photo-lightbox-close" type="button" onClick={() => setLightbox(null)}>
            {renderIcon(Icons.x, 16)}
          </button>
          <img src={lightbox.data || lightbox.thumbnailDataUrl} alt={lightbox.caption || lightbox.filename || "Site photo"} />
        </div>
      ) : null}
    </div>
  );
}
