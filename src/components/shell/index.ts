/**
 * Shell components barrel.
 *
 * Re-exports all public shell layout components so consumers can import from
 * `@/components/shell` without knowing the internal file layout.
 */

export { default as AppFooter } from "./AppFooter";
export { default as AppHeader } from "./AppHeader";
export { default as AppShell } from "./AppShell";
export { default as AppSidebar } from "./AppSidebar";
export { default as BottomTabBar } from "./BottomTabBar";
export { default as HeaderSearch } from "./HeaderSearch";
export { default as HeaderShell } from "./HeaderShell";
export { default as MoreSheet } from "./MoreSheet";
export { default as ThemeToggle } from "./ThemeToggle";
export { default as UserMenu } from "./UserMenu";
export { useSidebarState } from "./useSidebarState";
export type { ShellUser } from "./types";
