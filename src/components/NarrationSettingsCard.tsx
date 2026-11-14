"use client";

/**
 * Settings → Narration. Per-browser narration preferences stored with the
 * reader prefs (localStorage): engine, on-device voice (with a preview
 * synthesized in the browser), and default playback speed. Changes save
 * immediately and apply the next time an article's narration loads.
 */

import { useEffect, useRef, useState } from "react";
import { Cloud, Cpu, Play } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardMeta,
  CardTitle,
  Field,
  SegmentedControl,
  Select,
  Stack,
  type SegmentedControlOption,
} from "@/components/ui";
import {
  getReaderPrefs,
  NARRATION_SPEEDS,
  setReaderPrefs,
  type NarrationEngine,
  type NarrationSpeed,
  type ReaderPrefs,
} from "@/lib/reader-prefs";
import {
  isParadeeEnglishVoice,
  PARADEE_ENGLISH_VOICES,
  PARADEE_VOICE_LABELS,
  type ParadeeEnglishVoice,
} from "@/lib/ondevice-tts/voices";

const ENGINE_OPTIONS: ReadonlyArray<SegmentedControlOption<NarrationEngine>> = [
  { value: "device", label: "On-device", icon: Cpu },
  { value: "cloud", label: "Cloud", icon: Cloud },
];
const ENGINE_LABEL = "Narration engine";
const ENGINE_DESCRIPTION =
  "On-device generates audio in your browser (WebGPU when available, otherwise WebAssembly). Cloud plays stored narration. If the chosen engine has no audio for an article, the other one is used.";
const PREVIEW_TEXT = "This is how narration will sound when you listen to an article.";

type PreviewState = "idle" | "loading" | "playing" | "error";

export default function NarrationSettingsCard() {
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [preview, setPreview] = useState<PreviewState>("idle");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setPrefs(getReaderPrefs());
    return () => previewAudioRef.current?.pause();
  }, []);

  function update(next: Partial<ReaderPrefs>) {
    // Re-read so changes made in the Reader since mount are not overwritten.
    const merged = { ...getReaderPrefs(), ...next };
    setReaderPrefs(merged);
    setPrefs(merged);
  }

  async function playPreview(voice: ParadeeEnglishVoice, speed: NarrationSpeed) {
    previewAudioRef.current?.pause();
    setPreview("loading");
    try {
      const { isOnDeviceTtsSupported, synthesizeNarrationOnDevice } = await import(
        "@/lib/ondevice-tts/client"
      );
      if (!isOnDeviceTtsSupported()) throw new Error("unsupported");
      let audioBlob: Blob | null = null;
      await synthesizeNarrationOnDevice(PREVIEW_TEXT, {
        voice,
        onSnapshot: (snapshot) => {
          if (snapshot.complete) audioBlob = snapshot.audio;
        },
      });
      if (!audioBlob) throw new Error("no audio");
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.playbackRate = speed;
      const finish = () => {
        URL.revokeObjectURL(url);
        setPreview((state) => (state === "playing" ? "idle" : state));
      };
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("pause", finish, { once: true });
      previewAudioRef.current = audio;
      setPreview("playing");
      await audio.play();
    } catch {
      setPreview("error");
    }
  }

  const engine = prefs?.narration ?? "device";
  const voice = prefs?.narrationVoice ?? PARADEE_ENGLISH_VOICES[0];
  const speed = prefs?.narrationSpeed ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Narration</CardTitle>
        <CardMeta>
          Saved in this browser. Changes apply the next time you open an article&rsquo;s narration.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <Stack gap="5">
          <div className="flex flex-col gap-[var(--space-2)]">
            <span className="text-[length:var(--text-sm)] font-medium text-text">{ENGINE_LABEL}</span>
            <p className="text-text-subtle text-[length:var(--text-xs)]">{ENGINE_DESCRIPTION}</p>
            <SegmentedControl
              label={ENGINE_LABEL}
              value={engine}
              onChange={(narration) => update({ narration })}
              options={ENGINE_OPTIONS}
              size="md"
            />
          </div>

          <div className="flex flex-col gap-[var(--space-2)]">
            <Field label="Voice" hint="Used for on-device narration.">
              <Select
                value={voice}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isParadeeEnglishVoice(next)) {
                    update({ narrationVoice: next });
                    setPreview("idle");
                  }
                }}
              >
                {PARADEE_ENGLISH_VOICES.map((id) => (
                  <option key={id} value={id}>
                    {PARADEE_VOICE_LABELS[id]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              leadingIcon={<Play size={16} aria-hidden />}
              loading={preview === "loading"}
              disabled={!prefs || preview === "playing"}
              onClick={() => void playPreview(voice, speed)}
              aria-label={`Preview ${PARADEE_VOICE_LABELS[voice]}`}
            >
              {preview === "loading" ? "Preparing…" : "Preview voice"}
            </Button>
            {preview === "error" ? (
              <p className="text-[length:var(--text-xs)] text-danger-text" role="alert">
                Preview isn&rsquo;t available in this browser. Cloud narration still works where articles have it.
              </p>
            ) : null}
          </div>

          <Field label="Default speed" hint="Starting speed for narration; change it any time in the player.">
            <Select
              value={String(speed)}
              onChange={(event) => {
                const next = Number(event.target.value);
                const match = NARRATION_SPEEDS.find((value) => value === next);
                if (match !== undefined) update({ narrationSpeed: match });
              }}
              className="sm:max-w-[12rem]"
            >
              {NARRATION_SPEEDS.map((value) => (
                <option key={value} value={String(value)}>
                  {value}&times;
                </option>
              ))}
            </Select>
          </Field>
        </Stack>
      </CardBody>
    </Card>
  );
}
