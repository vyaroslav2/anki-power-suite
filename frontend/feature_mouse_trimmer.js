// feature_mouse_trimmer.js
window.PowerSuite.initMouseTrimmer = function () {
  if (window.PowerSuite._mouseTrimmerInitialized) return;
  window.PowerSuite._mouseTrimmerInitialized = true;

  window.PowerSuite.log("Initializing Mouse Trimmer & Mask...", "info");

  // ==========================================
  // INVISIBLE MASK UTILITY (For Mouse Only)
  // ==========================================
  const toggleMask = (hide) => {
    const STYLE_ID = "powersuite-invisible-mask";
    const css = `
            ::selection { background: transparent !important; color: inherit !important; }
            *::selection { background: transparent !important; color: inherit !important; }
        `;

    const roots = [document.head];
    const editableRoot = window.PowerSuite.getEditableRoot();
    if (editableRoot && editableRoot.getRootNode() !== document) {
      roots.push(editableRoot.getRootNode());
    }

    roots.forEach((root) => {
      let styleEl = root.querySelector(`#${STYLE_ID}`);
      if (hide) {
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
          styleEl.textContent = css;
          root.appendChild(styleEl);
        }
      } else {
        if (styleEl) styleEl.remove();
      }
    });
  };

  let maskTimeout;
  const applyTemporaryMask = () => {
    toggleMask(true);
    clearTimeout(maskTimeout);
    maskTimeout = setTimeout(() => toggleMask(false), 120);
  };

  let lastSelectionSource = "mouse";

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.detail >= 2) {
        lastSelectionSource = "doubleclick";
        applyTemporaryMask();
      } else {
        lastSelectionSource = "click";
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        lastSelectionSource = "keyboard_hijack";
      } else if (e.shiftKey || e.key.includes("Arrow")) {
        lastSelectionSource = "keyboard";
      }
    },
    true,
  );

  // ==========================================
  // FEATURE 1: ASYNC TRIMMER (For Mouse Only)
  // ==========================================
  let trimTimeout;
  document.addEventListener("selectionchange", () => {
    if (window.PowerSuite.isProcessing) return;
    if (lastSelectionSource !== "doubleclick") return;

    clearTimeout(trimTimeout);
    trimTimeout = setTimeout(() => {
      if (window.PowerSuite.isProcessing) return;

      const editableRoot = window.PowerSuite.getEditableRoot();
      if (!editableRoot) return;

      const rootNode = editableRoot.getRootNode();
      const sel = rootNode.getSelection
        ? rootNode.getSelection()
        : window.getSelection();

      if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) return;

      const range = sel.getRangeAt(0);
      const isForward =
        sel.focusNode === range.endContainer &&
        sel.focusOffset === range.endOffset;
      if (!isForward) return;

      let text = sel.toString();
      if (/^[\s\u00A0]+$/.test(text) || text.trim().includes(" ")) return;

      let trimmed = false;
      let sanity = 10;
      while (text.length > 0 && /[\s\u00A0]$/.test(text) && sanity-- > 0) {
        sel.modify("extend", "backward", "character");
        text = sel.toString();
        trimmed = true;
      }
    }, 10);
  });
};
window.PowerSuite.initMouseTrimmer();
