"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "./Button";
import { Popover } from "./Popover";

const CHEVRON_SIZE = 16;
const OPTION_CHECK_SIZE = 14;
 
 const selectVariants = cva(
   cn(
     "w-full justify-between appearance-none bg-surface text-text rounded-[var(--radius-md)] border cursor-pointer",
     "pl-[var(--space-3)] pr-[var(--space-3)] text-[length:var(--text-base)] font-normal",
     "shadow-none active:translate-y-0",
     "transition-[border-color,box-shadow]",
     "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
     "outline-none",
     "disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-not-allowed",
   ),
   {
     variants: {
       selectSize: {
         sm: "h-8",
         md: "h-10",
       },
       invalid: {
         true: cn(
           "border-danger",
           "focus-visible:border-danger",
           "focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--danger)]",
         ),
         false: cn(
           "border-border-strong hover:border-text-subtle",
           "focus-visible:border-primary",
           focusRing,
         ),
       },
     },
     defaultVariants: { selectSize: "md", invalid: false },
   },
 );
 
 export type SelectMenuWidth = "trigger" | "content";
 export type SelectMenuAlign = "start" | "end";
 
 interface ParsedOption {
   value: string;
   label: React.ReactNode;
   disabled: boolean;
   selected: boolean;
 }
 
 export interface SelectProps
   extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">,
     VariantProps<typeof selectVariants> {
   /** Match the menu to the trigger or size it to its option content. */
   menuWidth?: SelectMenuWidth;
   /** Horizontal menu alignment relative to the trigger. */
   menuAlign?: SelectMenuAlign;
   /** Additional token-driven classes for the menu panel. */
   menuClassName?: string;
 }
 
 function nodeText(node: React.ReactNode): string {
   if (typeof node === "string" || typeof node === "number") {
     return String(node);
   }
   if (Array.isArray(node)) return node.map(nodeText).join("");
   if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
     return nodeText(node.props.children);
   }
   return "";
 }
 
 function collectOptions(
   children: React.ReactNode,
   options: ParsedOption[] = [],
 ): ParsedOption[] {
   React.Children.forEach(children, (child) => {
     if (!React.isValidElement(child)) return;
     if (child.type === React.Fragment) {
       collectOptions(
         (child.props as { children?: React.ReactNode }).children,
         options,
       );
       return;
     }
     if (child.type !== "option") return;
 
     const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
     const label = props.label ?? props.children;
     options.push({
       value: props.value === undefined ? nodeText(label) : String(props.value),
       label,
       disabled: Boolean(props.disabled),
       selected: Boolean(props.selected),
     });
   });
   return options;
 }
 
 function normalizeValue(
   value: string | number | readonly string[] | undefined,
 ): string | undefined {
   if (Array.isArray(value)) {
     return value[0] === undefined ? undefined : String(value[0]);
   }
   return value === undefined ? undefined : String(value);
 }
 
 function initialValue(
   value: SelectProps["value"],
   defaultValue: SelectProps["defaultValue"],
   options: ParsedOption[],
 ): string {
   return (
     normalizeValue(value) ??
     normalizeValue(defaultValue) ??
     options.find((option) => option.selected)?.value ??
     options[0]?.value ??
     ""
   );
 }
 
 function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
   if (typeof ref === "function") {
     ref(value);
   } else if (ref) {
     ref.current = value;
   }
 }
 
 /**
  * Shared single-value dropdown.
  *
  * JavaScript path: renders a token-driven button + listbox on the shared
  * viewport-aware Popover. The selected option receives initial focus; arrows,
  * Home/End, Escape, Tab trapping, outside-click dismissal, and focus restore
  * are handled by Popover.
  *
  * Form/no-JS path: keeps the native `<select>` as the source of truth. It is
  * visible before hydration (and when JavaScript is unavailable), then hidden
  * while the custom trigger is active. This preserves `name`, `required`,
  * `defaultValue`, native form submission/reset, forwarded refs, and the
  * existing `onChange(ChangeEvent<HTMLSelectElement>)` contract.
  *
  * Accessibility: pair with `Field`/`Label` or provide `aria-label`. The visual
  * trigger owns the original `id`, `role="combobox"`, expanded/invalid/required
  * state, and controls a `role="listbox"` of `role="option"` buttons.
   *
   * @example
   * <Field label="Language">
   *   <Select value={language} onChange={(event) => setLanguage(event.target.value)}>
   *     <option value="en">English</option>
   *     <option value="zh">Chinese</option>
   *   </Select>
   * </Field>
  */
 export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
   function Select(
     {
       selectSize = "md",
       invalid = false,
       menuWidth = "trigger",
       menuAlign = "start",
       menuClassName,
       className,
       children,
       id,
       value,
       defaultValue,
       disabled,
       required,
       multiple,
       tabIndex,
       onChange,
       onInvalid,
       ...nativeProps
     },
     forwardedRef,
   ) {
     const options = React.useMemo(() => collectOptions(children), [children]);
     const isControlled = value !== undefined;
     const controlledValue = normalizeValue(value);
     const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
       initialValue(value, defaultValue, options),
     );
     const [mounted, setMounted] = React.useState(false);
     const [open, setOpen] = React.useState(false);
     const [nativeInvalid, setNativeInvalid] = React.useState(false);
     const nativeRef = React.useRef<HTMLSelectElement>(null);
     const triggerRef = React.useRef<HTMLButtonElement>(null);
     const selectedOptionRef = React.useRef<HTMLButtonElement>(null);
     const reactId = React.useId();
     const controlId = id ?? `select-${reactId}`;
     const nativeId = `${controlId}-native`;
     const listboxId = `${controlId}-listbox`;
     const selectedValue = isControlled
       ? (controlledValue ?? "")
       : uncontrolledValue;
     const selectedOption =
       options.find((option) => option.value === selectedValue) ?? options[0];
     const isInvalid = Boolean(invalid || nativeInvalid);
     const customEnabled = mounted && !multiple;
 
     React.useEffect(() => setMounted(true), []);
 
     React.useEffect(() => {
       if (isControlled || options.length === 0) return;
       if (options.some((option) => option.value === uncontrolledValue)) return;
       setUncontrolledValue(options[0]!.value);
     }, [isControlled, options, uncontrolledValue]);
 
     React.useEffect(() => {
       if (!customEnabled) return;
       const form = nativeRef.current?.form;
       if (!form) return;
 
       function handleReset() {
         queueMicrotask(() => {
           const nextValue = nativeRef.current?.value;
           if (nextValue !== undefined && !isControlled) {
             setUncontrolledValue(nextValue);
           }
           setNativeInvalid(false);
           setOpen(false);
         });
       }
 
       form.addEventListener("reset", handleReset);
       return () => form.removeEventListener("reset", handleReset);
     }, [customEnabled, isControlled]);
 
     const setNativeRef = React.useCallback(
       (node: HTMLSelectElement | null) => {
         nativeRef.current = node;
         assignRef(forwardedRef, node);
       },
       [forwardedRef],
     );
 
     function handleNativeChange(event: React.ChangeEvent<HTMLSelectElement>) {
       if (!isControlled) setUncontrolledValue(event.currentTarget.value);
       setNativeInvalid(false);
       onChange?.(event);
     }
 
     function handleNativeInvalid(event: React.InvalidEvent<HTMLSelectElement>) {
       if (customEnabled) {
         event.preventDefault();
         setNativeInvalid(true);
         triggerRef.current?.focus();
       }
       onInvalid?.(event);
     }
 
     function chooseValue(nextValue: string) {
       const nativeSelect = nativeRef.current;
       if (!nativeSelect || disabled) return;
 
       setOpen(false);
       if (!isControlled) setUncontrolledValue(nextValue);
       nativeSelect.value = nextValue;
       nativeSelect.dispatchEvent(new Event("input", { bubbles: true }));
       nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
     }
 
     function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
       if (
         event.key === "ArrowDown" ||
         event.key === "ArrowUp" ||
         event.key === "Home" ||
         event.key === "End"
       ) {
         event.preventDefault();
         setOpen(true);
       }
     }
 
     return (
       <div className={customEnabled ? "contents" : "relative inline-flex w-full items-center"}>
         <select
           {...nativeProps}
           ref={setNativeRef}
           id={customEnabled ? nativeId : controlId}
           value={value}
           defaultValue={value === undefined ? defaultValue : undefined}
           disabled={disabled}
           required={required}
           multiple={multiple}
           tabIndex={customEnabled ? -1 : tabIndex}
           hidden={customEnabled}
           aria-hidden={customEnabled || undefined}
          aria-label={customEnabled ? undefined : nativeProps["aria-label"]}
          aria-labelledby={customEnabled ? undefined : nativeProps["aria-labelledby"]}
          aria-describedby={customEnabled ? undefined : nativeProps["aria-describedby"]}
           aria-invalid={isInvalid || undefined}
          className={
            customEnabled
              ? undefined
              : cn(
                  selectVariants({ selectSize, invalid: isInvalid }),
                  "pr-[var(--space-8)]",
                  className,
                )
          }
           onChange={handleNativeChange}
           onInvalid={handleNativeInvalid}
         >
           {children}
         </select>
 
         {!customEnabled ? (
           <ChevronDown
             aria-hidden
             size={CHEVRON_SIZE}
             className="pointer-events-none absolute right-[var(--space-3)] text-text-subtle"
           />
         ) : (
           <>
             <Button
               ref={triggerRef}
               id={controlId}
               type="button"
               variant="outline"
               size={selectSize === "sm" ? "sm" : "md"}
               role="combobox"
               value={selectedValue}
               data-value={selectedValue}
               aria-haspopup="listbox"
               aria-expanded={open}
               aria-controls={listboxId}
               aria-label={nativeProps["aria-label"]}
               aria-labelledby={nativeProps["aria-labelledby"]}
               aria-describedby={nativeProps["aria-describedby"]}
               aria-invalid={isInvalid || nativeProps["aria-invalid"] || undefined}
               aria-required={required || undefined}
               disabled={disabled}
               tabIndex={tabIndex}
               title={nativeProps.title}
               onClick={() => setOpen((current) => !current)}
               onKeyDown={handleTriggerKeyDown}
               trailingIcon={
                 <ChevronDown
                   aria-hidden
                   size={CHEVRON_SIZE}
                   className={cn(
                     "transition-transform [transition-duration:var(--duration-fast)]",
                     open && "rotate-180",
                   )}
                 />
               }
               className={cn(
                 selectVariants({ selectSize, invalid: isInvalid }),
                 className,
               )}
             >
               <span className="min-w-0 truncate text-left">
                 {selectedOption?.label ?? selectedValue}
               </span>
             </Button>
 
             <Popover
               open={open}
               onClose={() => setOpen(false)}
               anchorRef={triggerRef}
               initialFocusRef={selectedOptionRef}
               label="Select options"
               align={menuAlign}
               matchAnchorWidth={menuWidth === "trigger"}
               className={cn("min-w-0 p-[var(--space-1)]", menuClassName)}
             >
               <ul
                 id={listboxId}
                 role="listbox"
                 aria-labelledby={controlId}
                 className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0"
               >
                 {options.map((option) => {
                   const selected = option.value === selectedValue;
                   return (
                     <li key={option.value} role="presentation">
                       <Button
                         ref={selected ? selectedOptionRef : undefined}
                         type="button"
                         variant="ghost"
                         size="sm"
                         role="option"
                         tabIndex={selected ? 0 : -1}
                         aria-selected={selected}
                         disabled={option.disabled}
                         onClick={() => chooseValue(option.value)}
                         trailingIcon={
                           selected ? <Check size={OPTION_CHECK_SIZE} aria-hidden /> : undefined
                         }
                         className={cn(
                           "h-auto min-h-8 w-full justify-between rounded-[var(--radius-sm)]",
                           "px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-sm)] font-normal",
                           "text-text hover:bg-bg-subtle",
                           selected && "font-semibold text-primary-text",
                         )}
                       >
                         <span className="min-w-0 truncate">{option.label}</span>
                       </Button>
                     </li>
                   );
                 })}
               </ul>
             </Popover>
           </>
         )}
       </div>
     );
   },
 );
 
Select.displayName = "Select";

export { selectVariants };
