/**
 * Barrel for the command palette subsystem (FE-16). Re-exports the palette,
 * provider, render items, item-derivation helpers, navigation helpers, and the
 * search/navigation/dialog hooks so callers can import from
 * `@/components/command`.
 */
export { default as CommandPalette } from "./CommandPalette";
export * from "./CommandPalette";
export { default as CommandPaletteProvider } from "./CommandPaletteProvider";
export * from "./CommandPaletteProvider";
export * from "./CommandPaletteItems";
export * from "./command-items";
export * from "./command-navigation";
export * from "./useArticleSearch";
export * from "./useCommandNavigation";
export * from "./useCommandPaletteDialog";
export * from "./useCommandPaletteSearch";
