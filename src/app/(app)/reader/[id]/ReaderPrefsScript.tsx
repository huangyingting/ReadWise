/**
 * Reader preference no-flash bootstrap script (REF-029).
 *
 * Renders an inline `<script>` that reads the `readwise:reader-prefs`
 * localStorage key and applies the saved reading mode, font scale, font
 * family, and line spacing to `#reader-root` before the first paint —
 * preventing a flash of the default (un-preferenced) appearance.
 *
 * Placement requirement: this component MUST be the first child of
 * `#reader-root`. `document.currentScript.parentElement` resolves to the
 * element BEFORE any of its children are painted. Using `getElementById`
 * instead would fail because the script executes before `#reader-root`
 * finishes parsing.
 *
 * The parent element carries `suppressHydrationWarning` because this script
 * mutates the element's `data-*` attributes and CSS custom properties during
 * pre-hydration, which would otherwise trigger a React hydration mismatch
 * warning on client restore.
 */
export default function ReaderPrefsScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
(function(){try{
  var raw=localStorage.getItem('readwise:reader-prefs');
  var prefs=raw?JSON.parse(raw):null;
  var el=document.currentScript&&document.currentScript.parentElement;
  if(!el)return;
  var mode=prefs&&prefs.mode?prefs.mode:(
    document.documentElement.dataset.theme==='dark'?'dark':'light'
  );
  el.dataset.readingMode=mode;
  var scale=prefs&&typeof prefs.fontScale==='number'?prefs.fontScale:1;
  el.style.setProperty('--reading-font-scale',String(scale));
  var font=prefs&&prefs.fontFamily?prefs.fontFamily:'serif';
  el.dataset.readingFont=font;
  var spacing=prefs&&prefs.lineSpacing?prefs.lineSpacing:'normal';
  el.dataset.readingSpacing=spacing;
}catch(e){}})();
        `.trim(),
      }}
    />
  );
}
