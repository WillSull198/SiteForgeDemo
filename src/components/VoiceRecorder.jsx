import { useEffect, useRef, useState } from "react";
import { get, put } from "../services/db";
import { Icons, renderIcon } from "./icons";
import { Button } from "./ui";

const recognitionCtor = () => {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAudioUrl(audioRef) {
  const id = audioRef?.id || null;
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (!id) {
      setUrl("");
      return () => {};
    }
    get("audio", id)
      .then((record) => {
        if (cancelled || !record?.blob) return;
        objectUrl = URL.createObjectURL(record.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return url;
}

export function AudioNotePlayer({ note }) {
  const url = useAudioUrl(note);
  return (
    <div className="mini-panel" style={{ marginTop: 8 }}>
      <div className="fb mb4">
        <div className="xs ct3">Voice note · {Math.round(note.durationSec || 0)}s</div>
        <span className="xs ct3">{note.createdAt ? new Date(note.createdAt).toLocaleString("en-AU") : ""}</span>
      </div>
      {url ? <audio controls src={url} style={{ width: "100%" }} /> : <div className="xs ct3">Loading audio...</div>}
      {note.transcript ? <div className="sm ct2" style={{ marginTop: 8 }}>{note.transcript}</div> : null}
    </div>
  );
}

export default function VoiceRecorder({ onVoiceNoteAdded }) {
  const recorderRef = useRef(null);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const finalTranscriptRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [latestNote, setLatestNote] = useState(null);

  useEffect(() => {
    setSupported(Boolean(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"));
    return () => {
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      recognitionRef.current?.stop?.();
    };
  }, []);

  const startRecording = async () => {
    setError("");
    setTranscript("");
    setLatestNote(null);
    finalTranscriptRef.current = "";
    if (!supported) {
      setError("Microphone unavailable - type your note instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const id = uuid();
        const createdAt = new Date().toISOString();
        await put("audio", { id, blob, durationSec, mimeType, createdAt });
        const note = {
          id,
          durationSec,
          mimeType,
          createdAt,
          transcript: finalTranscriptRef.current.trim(),
        };
        setLatestNote(note);
        onVoiceNoteAdded?.(note);
        streamRef.current?.getTracks?.().forEach((track) => track.stop());
        streamRef.current = null;
      };

      const Recognition = recognitionCtor();
      if (Recognition) {
        const recognition = new Recognition();
        recognition.lang = "en-AU";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          let finalText = finalTranscriptRef.current;
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const text = event.results[index][0]?.transcript || "";
            if (event.results[index].isFinal) {
              finalText = `${finalText} ${text}`.trim();
            } else {
              interim = `${interim} ${text}`.trim();
            }
          }
          finalTranscriptRef.current = finalText;
          setTranscript(`${finalText} ${interim}`.trim());
        };
        recognition.onerror = () => {};
        recognitionRef.current = recognition;
        recognition.start();
      }

      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(`Microphone unavailable - type your note instead. ${err?.message || ""}`.trim());
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    recorderRef.current?.stop?.();
    recorderRef.current = null;
    setRecording(false);
  };

  if (!supported) {
    return <div className="notice-banner">Microphone unavailable - type your note instead.</div>;
  }

  return (
    <div className="mini-panel">
      <div className="fb mb8">
        <div>
          <div className="b sm">Voice note</div>
          <div className="xs ct3">Audio stays in IndexedDB; only the note reference is saved in the diary.</div>
        </div>
        <Button small tone={recording ? "bt-r" : "bt-p"} icon={recording ? Icons.x : Icons.mic || Icons.chat} onClick={recording ? stopRecording : startRecording}>
          {recording ? "Stop" : "Record"}
        </Button>
      </div>
      {recording ? <div className="xs ct3">{renderIcon(Icons.clock, 12)} Recording...</div> : null}
      {transcript ? <div className="sm ct2" style={{ marginTop: 8 }}>{transcript}</div> : null}
      {latestNote ? <AudioNotePlayer note={latestNote} /> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {!recognitionCtor() ? <div className="xs ct3" style={{ marginTop: 8 }}>Live transcript requires Chrome, Edge or Safari speech recognition support. Audio recording still works.</div> : null}
    </div>
  );
}
