"use client";

import { useCallback, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";

export function useMirroredElementRef<T extends HTMLElement>(
  externalRef: RefObject<T | null>,
) {
  const elementRef = useRef<T | null>(null);

  const setElement = useCallback((element: T | null) => {
    elementRef.current = element;
    (externalRef as MutableRefObject<T | null>).current = element;
  }, [externalRef]);

  return { elementRef, setElement };
}
