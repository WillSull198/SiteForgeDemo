/* SiteForge audit: Added shared, reusable photo upload with browser-side image
   compression, IndexedDB photo persistence, thumbnail previews, remove controls,
   and a lightbox. This replaces one-off broken image placeholders across modules. */

import { useEffect, useRef, useState } from "react";
import { get, put } from "../services/db";
import { Icons, renderIcon } from "./icons";

const photoDataCache = new Map();

function toPhotoReference(record) {
  return {
    id: record.id,
    filename: record.filename,
    size: record.size,
    mimeType: record.mimeType,
    parentType: record.parentType,
    parentId: record.parentId,
    geo: record.geo,
    takenAt: record.takenAt,
    caption: record.caption,
    createdAt: record.createdAt,
  };
}

export function usePhotoData(photo) {
  const id = photo && typeof photo === "object" ? photo.id : null;
  const inlineData = photo && typeof photo === "object" ? photo.data || photo.thumbnailDataUrl || "" : "";
  const [dataUrl, setDataUrl] = useState(() => inlineData || (id ? photoDataCache.get(id) || "" : ""));

  useEffect(() => {
    let cancelled = false;
    if (inlineData) {
      setDataUrl(inlineData);
      if (id) photoDataCache.set(id, inlineData);
      return () => {
        cancelled = true;
      };
    }
    if (!id) {
      setDataUrl("");
      return () => {
        cancelled = true;
      };
    }
    const cached = photoDataCache.get(id);
    if (cached) {
      setDataUrl(cached);
      return () => {
        cancelled = true;
      };
    }
    get("photos", id)
      .then((record) => {
        if (cancelled || !record?.data) return;
        photoDataCache.set(id, record.data);
        setDataUrl(record.data);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [id, inlineData]);

  return dataUrl;
}

function PhotoThumb({ photo, index, onRemove, onOpen }) {
  const labelOnly = typeof photo === "string";
  const dataUrl = usePhotoData(labelOnly ? null : photo);
  const alt = labelOnly ? photo : photo.caption || photo.filename || "Uploaded site photo";
  return (
    <button className="photo-thumb" type="button" onClick={() => !labelOnly && onOpen?.(photo)}>
      {labelOnly ? (
        <span className="photo-label">{photo}</span>
      ) : dataUrl ? (
        <img src={dataUrl} alt={alt} />
      ) : (
        <span className="photo-label">{photo.filename || `Photo ${index + 1}`}</span>
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
}

function LightboxImage({ photo }) {
  const dataUrl = usePhotoData(photo);
  return dataUrl ? <img src={dataUrl} alt={photo.caption || photo.filename || "Site photo"} /> : <div className="photo-label">Loading photo...</div>;
}

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

function readAscii(view, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint8(offset + index);
    if (!code) break;
    value += String.fromCharCode(code);
  }
  return value;
}

function ifdValueOffset(view, tiffStart, entryOffset, littleEndian, type, count) {
  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  const byteLength = (typeSizes[type] || 1) * count;
  const raw = view.getUint32(entryOffset + 8, littleEndian);
  return byteLength <= 4 ? entryOffset + 8 : tiffStart + raw;
}

function readRational(view, offset, littleEndian) {
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  return denominator ? numerator / denominator : 0;
}

function readIfdEntries(view, ifdOffset, littleEndian) {
  const count = view.getUint16(ifdOffset, littleEndian);
  return Array.from({ length: count }, (_, index) => ifdOffset + 2 + index * 12);
}

function readIfdValue(view, tiffStart, entryOffset, littleEndian) {
  const tag = view.getUint16(entryOffset, littleEndian);
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const offset = ifdValueOffset(view, tiffStart, entryOffset, littleEndian, type, count);
  if (type === 2) return { tag, value: readAscii(view, offset, count) };
  if (type === 3) return { tag, value: count === 1 ? view.getUint16(offset, littleEndian) : Array.from({ length: count }, (_, index) => view.getUint16(offset + index * 2, littleEndian)) };
  if (type === 4) return { tag, value: count === 1 ? view.getUint32(offset, littleEndian) : Array.from({ length: count }, (_, index) => view.getUint32(offset + index * 4, littleEndian)) };
  if (type === 5) return { tag, value: Array.from({ length: count }, (_, index) => readRational(view, offset + index * 8, littleEndian)) };
  return { tag, value: null };
}

function dmsToDecimal(parts, ref) {
  if (!Array.isArray(parts) || parts.length < 3) return null;
  const decimal = Number(parts[0] || 0) + Number(parts[1] || 0) / 60 + Number(parts[2] || 0) / 3600;
  return ["S", "W"].includes(String(ref || "").toUpperCase()) ? -decimal : decimal;
}

async function extractJpegExifGps(file) {
  if (!/image\/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const segmentLength = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && readAscii(view, offset + 4, 6) === "Exif") {
      const tiffStart = offset + 10;
      const endian = readAscii(view, tiffStart, 2);
      const littleEndian = endian === "II";
      if (!littleEndian && endian !== "MM") return null;
      const firstIfdOffset = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
      const gpsPointerEntry = readIfdEntries(view, firstIfdOffset, littleEndian)
        .map((entryOffset) => readIfdValue(view, tiffStart, entryOffset, littleEndian))
        .find((entry) => entry.tag === 0x8825);
      if (!gpsPointerEntry?.value) return null;
      const gpsIfdOffset = tiffStart + gpsPointerEntry.value;
      const gps = {};
      readIfdEntries(view, gpsIfdOffset, littleEndian).forEach((entryOffset) => {
        const { tag, value } = readIfdValue(view, tiffStart, entryOffset, littleEndian);
        if (tag === 1) gps.latRef = value;
        if (tag === 2) gps.lat = value;
        if (tag === 3) gps.lngRef = value;
        if (tag === 4) gps.lng = value;
        if (tag === 16) gps.directionRef = value;
        if (tag === 17) gps.direction = Array.isArray(value) ? value[0] : value;
      });
      const lat = dmsToDecimal(gps.lat, gps.latRef);
      const lng = dmsToDecimal(gps.lng, gps.lngRef);
      if (lat == null || lng == null) return null;
      return {
        lat,
        lng,
        direction: gps.direction ?? null,
        directionRef: gps.directionRef || null,
        capturedAt: file.lastModified || Date.now(),
        source: "exif",
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
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

async function extractImageMetadata(file) {
  try {
    const exifGps = await extractJpegExifGps(file);
    if (exifGps) return exifGps;
  } catch {
    // Fall through to device location when EXIF is absent or malformed.
  }
  return captureCurrentLocation();
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
        const geo = await extractImageMetadata(file);
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
      onPhotosAdded?.(records.map(toPhotoReference));
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
          const key = labelOnly ? `${photo}-${index}` : photo.id || photo.filename || index;
          return <PhotoThumb key={key} photo={photo} index={index} onRemove={onRemove} onOpen={setLightbox} />;
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
          <LightboxImage photo={lightbox} />
        </div>
      ) : null}
    </div>
  );
}
