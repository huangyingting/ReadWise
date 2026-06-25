"use client";

import { useCallback, useReducer, useRef } from "react";
import type { HighlightColor } from "@/components/ReaderHighlightsProvider";
import type { SavedAnchor } from "./selectionHelpers";

export type OpenSurface =
  | "dictionary"
  | "toolbar"
  | "popover"
  | "translate"
  | "grammar"
  | null;

interface SurfaceState {
  openSurface: OpenSurface;
  dictAnchor: { x: number; y: number } | null;
  toolbarRect: DOMRect | null;
  toolbarColor: HighlightColor;
  toolbarShowDefine: boolean;
  toolbarShowGrammar: boolean;
  editHlId: string | null;
  editMarkEl: HTMLElement | null;
}

type SurfaceAction =
  | { type: "CLOSE_ALL" }
  | { type: "OPEN_DICTIONARY"; x: number; y: number }
  | {
      type: "OPEN_TOOLBAR";
      rect: DOMRect;
      showDefine: boolean;
      showGrammar: boolean;
      color?: HighlightColor;
    }
  | { type: "OPEN_EDIT_POPOVER"; hlId: string; markEl: HTMLElement }
  | { type: "TRANSITION_TO_TRANSLATE" }
  | { type: "TRANSITION_TO_GRAMMAR" }
  | { type: "DISMISS_TOOLBAR" }
  | { type: "SET_TOOLBAR_COLOR"; color: HighlightColor };

const initialState: SurfaceState = {
  openSurface: null,
  dictAnchor: null,
  toolbarRect: null,
  toolbarColor: "yellow",
  toolbarShowDefine: false,
  toolbarShowGrammar: false,
  editHlId: null,
  editMarkEl: null,
};

function surfaceReducer(state: SurfaceState, action: SurfaceAction): SurfaceState {
  switch (action.type) {
    case "CLOSE_ALL":
      return { ...initialState, toolbarColor: state.toolbarColor };

    case "OPEN_DICTIONARY":
      return {
        ...initialState,
        toolbarColor: state.toolbarColor,
        openSurface: "dictionary",
        dictAnchor: { x: action.x, y: action.y },
      };

    case "OPEN_TOOLBAR":
      return {
        ...state,
        openSurface: "toolbar",
        toolbarRect: action.rect,
        toolbarShowDefine: action.showDefine,
        toolbarShowGrammar: action.showGrammar,
        toolbarColor: action.color ?? state.toolbarColor,
        dictAnchor: null,
        editHlId: null,
        editMarkEl: null,
      };

    case "OPEN_EDIT_POPOVER":
      return {
        ...initialState,
        toolbarColor: state.toolbarColor,
        openSurface: "popover",
        editHlId: action.hlId,
        editMarkEl: action.markEl,
      };

    // Transitions toolbar → translate/grammar: preserve savedAnchorRef and
    // toolbarColor, clear toolbarRect, change the surface.
    case "TRANSITION_TO_TRANSLATE":
      return { ...state, openSurface: "translate", toolbarRect: null };

    case "TRANSITION_TO_GRAMMAR":
      return { ...state, openSurface: "grammar", toolbarRect: null };

    // Atomic: only dismisses when the toolbar is actually the open surface.
    // Used by the selectionchange listener to avoid a stale-closure race.
    case "DISMISS_TOOLBAR":
      return state.openSurface === "toolbar"
        ? { ...state, openSurface: null, toolbarRect: null }
        : state;

    case "SET_TOOLBAR_COLOR":
      return { ...state, toolbarColor: action.color };

    default:
      return state;
  }
}

/**
 * Manages the single-surface-open-at-a-time invariant for the WordLookup
 * reader interaction subsystem. Exposes typed action helpers so callers never
 * dispatch raw action objects.
 *
 * `savedAnchorRef` is a mutable ref (not reducer state) because it holds the
 * selection anchor captured on mouseup/keydown. It is cleared on `closeAll`
 * and updated by the caller's selection handlers.
 */
export function useSurfaceController() {
  const [state, dispatch] = useReducer(surfaceReducer, initialState);
  const savedAnchorRef = useRef<SavedAnchor | null>(null);

  const closeAll = useCallback(() => {
    savedAnchorRef.current = null;
    dispatch({ type: "CLOSE_ALL" });
  }, []);

  const openDictionary = useCallback((x: number, y: number) => {
    dispatch({ type: "OPEN_DICTIONARY", x, y });
  }, []);

  const openToolbar = useCallback(
    (
      rect: DOMRect,
      showDefine: boolean,
      showGrammar: boolean,
      color?: HighlightColor,
    ) => {
      dispatch({ type: "OPEN_TOOLBAR", rect, showDefine, showGrammar, color });
    },
    [],
  );

  const openEditPopover = useCallback(
    (hlId: string, markEl: HTMLElement) => {
      dispatch({ type: "OPEN_EDIT_POPOVER", hlId, markEl });
    },
    [],
  );

  const transitionToTranslate = useCallback(() => {
    dispatch({ type: "TRANSITION_TO_TRANSLATE" });
  }, []);

  const transitionToGrammar = useCallback(() => {
    dispatch({ type: "TRANSITION_TO_GRAMMAR" });
  }, []);

  const dismissToolbar = useCallback(() => {
    dispatch({ type: "DISMISS_TOOLBAR" });
  }, []);

  const setToolbarColor = useCallback((color: HighlightColor) => {
    dispatch({ type: "SET_TOOLBAR_COLOR", color });
  }, []);

  return {
    ...state,
    savedAnchorRef,
    closeAll,
    openDictionary,
    openToolbar,
    openEditPopover,
    transitionToTranslate,
    transitionToGrammar,
    dismissToolbar,
    setToolbarColor,
  };
}
