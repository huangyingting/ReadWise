"use client";

import { AlertTriangle, MicOff } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ErrorNoticeType = "mic-denied" | "no-device" | "error";

type Props = {
  type: ErrorNoticeType;
  errorMsg?: string | null;
  onRetry: () => void;
};

const COPY: Record<
  ErrorNoticeType,
  { icon: typeof MicOff | typeof AlertTriangle; title: string; body: string; btn: string }
> = {
  "mic-denied": {
    icon: MicOff,
    title: "Microphone access denied",
    body: "ReadWise can\u2019t hear your microphone. To practice speaking, allow microphone access for this site in your browser\u2019s address-bar settings (the lock icon \u2192 Microphone \u2192 Allow), then try again.",
    btn: "Try again",
  },
  "no-device": {
    icon: MicOff,
    title: "No microphone found",
    body: "No microphone was detected. Connect one and try again.",
    btn: "Try again",
  },
  error: {
    icon: AlertTriangle,
    title: "Something went wrong",
    body: "Something went wrong scoring that. Check your connection and try again.",
    btn: "Retry",
  },
};

export function ErrorNotice({ type, errorMsg, onRetry }: Props) {
  const { icon: Icon, title, body, btn } = COPY[type];
  const displayBody = type === "error" ? (errorMsg ?? body) : body;

  return (
    <div className="rw-speak-note" role="alert">
      <Icon size={16} className="rw-speak-note-icon" aria-hidden />
      <div className="rw-speak-note-body">
        <p className="rw-speak-note-title">{title}</p>
        <p className="rw-speak-note-copy">{displayBody}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {btn}
        </Button>
      </div>
    </div>
  );
}
