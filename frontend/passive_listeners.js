window.PowerSuite.initPassiveListeners = function () {
  // Prevent attaching multiple listeners if Anki reloads the webview
  if (window.PowerSuite._listenersInitialized) return;
  window.PowerSuite._listenersInitialized = true;

  window.PowerSuite.log(
    "Initializing Smart Trim background listener...",
    "info",
  );

  document.addEventListener("selectionchange", (e) => {
    // 1. TRAFFIC COP: If AI or Line Formatter is running, DO NOT TOUCH THE CURSOR.
    if (window.PowerSuite.isProcessing) return;

    // 2. Prevent infinite loops (when we modify the selection, it fires this event again)
    if (window.PowerSuite._isTrimming) return;

    const editableRoot = window.PowerSuite.getEditableRoot();
    if (!editableRoot) return;

    const sel = editableRoot.getSelection
      ? editableRoot.getSelection()
      : window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const text = sel.toString();
    const isPureSpace = /^[\s\u00A0]+$/.test(text);

    // If the user selected a word, but accidentally grabbed the trailing space
    if (!isPureSpace && /[\s\u00A0]$/.test(text)) {
      // Lock the trim state
      window.PowerSuite._isTrimming = true;

      // Push selection back by 1 character
      sel.modify("extend", "backward", "character");
      window.PowerSuite.log("Smart Trim: Removed trailing space.", "success");

      // Unlock immediately after the browser repaints the cursor
      requestAnimationFrame(() => {
        window.PowerSuite._isTrimming = false;
      });
    }
  });
};

// Start it up!
window.PowerSuite.initPassiveListeners();
