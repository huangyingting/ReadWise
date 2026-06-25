"use client";

import { useCallback, useRef, useState } from "react";

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
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const n = (v - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMeterLevel(Math.min(1, rms * 5));
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
