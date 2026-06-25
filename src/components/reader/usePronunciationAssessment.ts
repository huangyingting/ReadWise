"use client";

import { useCallback, useRef } from "react";
import type { SpeechRecognitionResult } from "microsoft-cognitiveservices-speech-sdk";
import {
  getWordBand,
  type AssessResult,
  type WordResult,
} from "@/components/reader/pronunciationTypes";

export function usePronunciationAssessment() {
  const recognizerRef = useRef<{ close: () => void } | null>(null);

  const closeRecognizer = useCallback(() => {
    recognizerRef.current?.close();
    recognizerRef.current = null;
  }, []);

  const runPronunciationAssessment = useCallback(
    async (
      token: string,
      region: string,
      referenceText: string,
    ): Promise<AssessResult> => {
      const sdk = await import("microsoft-cognitiveservices-speech-sdk");

      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = "en-US";

      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();

      const pronConfig = new sdk.PronunciationAssessmentConfig(
        referenceText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word,
        true,
      );

      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      pronConfig.applyTo(recognizer);
      recognizerRef.current = recognizer;

      return new Promise<AssessResult>((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (speechResult: SpeechRecognitionResult) => {
            recognizerRef.current = null;
            try {
              recognizer.close();
            } catch {
              /* ignore close errors */
            }

            const assessment = sdk.PronunciationAssessmentResult.fromResult(speechResult);
            if (!assessment) {
              reject(new Error("No assessment data in result"));
              return;
            }

            const detailWords = assessment.detailResult?.Words ?? [];
            const wordResults: WordResult[] = detailWords.map((w: unknown) => {
              const wd = w as {
                Word: string;
                PronunciationAssessment?: { AccuracyScore: number; ErrorType: string };
              };
              const score = wd.PronunciationAssessment?.AccuracyScore ?? 100;
              const errorType = wd.PronunciationAssessment?.ErrorType ?? "None";
              return {
                word: wd.Word,
                score: Math.round(score),
                errorType,
                band: getWordBand(score, errorType),
              };
            });

            resolve({
              accuracyScore: Math.round(assessment.accuracyScore),
              fluencyScore: Math.round(assessment.fluencyScore),
              completenessScore: Math.round(assessment.completenessScore),
              pronScore: Math.round(assessment.pronunciationScore),
              words: wordResults,
            });
          },
          (err: string | Error) => {
            recognizerRef.current = null;
            try {
              recognizer.close();
            } catch {
              /* ignore */
            }
            const msg = typeof err === "string" ? err : (err?.message ?? "Recognition failed");
            reject(new Error(msg));
          },
        );
      });
    },
    [],
  );

  return { runPronunciationAssessment, closeRecognizer };
}
