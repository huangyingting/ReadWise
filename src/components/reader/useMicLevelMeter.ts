"use client";

import { useCallback, useRef, useState } from "react";

const FFT_SIZE = 256;
const PCM_MIDPOINT = 128;
const PCM_NORMALIZER = 128;
const LEVEL_GAIN = 5;
const MAX_METER_LEVEL = 1;

function calculateMeterLevel(samples: Uint8Array) {
  let sum = 0;

  for (const value of samples) {
    const normalized = (value - PCM_MIDPOINT) / PCM_NORMALIZER;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / samples.length);
  return Math.min(MAX_METER_LEVEL, rms * LEVEL_GAIN);
}

export function useMicLevelMeter() {
  const [meterLevel, setMeterLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterAnimRef = useRef<number | null>(null);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      meterStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteTimeDomainData(buf);
        setMeterLevel(calculateMeterLevel(buf));
        meterAnimRef.current = requestAnimationFrame(tick);
      }
      meterAnimRef.current = requestAnimationFrame(tick);
    } catch {
      // Meter unavailable — degrade gracefully (just no meter visuals).
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (meterAnimRef.current !== null) {
      cancelAnimationFrame(meterAnimRef.current);
      meterAnimRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {
      /* ignore */
    });
    audioCtxRef.current = null;
    analyserRef.current = null;
    meterStreamRef.current?.getTracks().forEach((t) => t.stop());
    meterStreamRef.current = null;
    setMeterLevel(0);
  }, []);

  return { meterLevel, startMeter, stopMeter };
}
