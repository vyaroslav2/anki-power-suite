window.PowerSuite.initPassiveListeners = function () {
  if (window.PowerSuite._listenersInitialized) return;
  window.PowerSuite._listenersInitialized = true;

  window.PowerSuite.log(
    "Initializing Smart Editor (Array Engine + Source Tracking)...",
    "info",
  );

  // ==========================================
  // INVISIBLE MASK UTILITY
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

  // ==========================================
  // SOURCE TRACKER
  // ==========================================
  let lastSelectionSource = "mouse";

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.detail >= 2) {
        lastSelectionSource = "doubleclick";
        applyTemporaryMask(); // ONLY mask on double clicks to prevent keyboard flickering
      } else {
        lastSelectionSource = "click";
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      // Word Selection (Ctrl+Shift+Right) -> Enable Trimming!
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        lastSelectionSource = "keyboard_word_forward";
      }
      // Character Selection (Shift+Right) or Backward Selection -> Disable Trimming
      else if (e.shiftKey || e.key.includes("Arrow") || e.ctrlKey) {
        lastSelectionSource = "keyboard_manual";
      }
    },
    true,
  );

  // ==========================================
  // FEATURE 1: NO TRAILING SPACE ON SELECTION
  // ==========================================
  let trimTimeout;
  document.addEventListener("selectionchange", () => {
    if (window.PowerSuite.isProcessing) return;

    // ONLY trim if the user double-clicked OR pressed Ctrl+Shift+Right
    if (
      lastSelectionSource !== "doubleclick" &&
      lastSelectionSource !== "keyboard_word_forward"
    )
      return;

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

      // BUGFIX: Only trim if the selection was made FORWARD.
      // Extending backward on a backward-selection grabs the wrong text!
      const range = sel.getRangeAt(0);
      const isForward =
        sel.focusNode === range.endContainer &&
        sel.focusOffset === range.endOffset;
      if (!isForward) return;

      let text = sel.toString();
      if (/^[\s\u00A0]+$/.test(text)) return;

      let trimmed = false;
      let sanity = 10;
      while (text.length > 0 && /[\s\u00A0]$/.test(text) && sanity-- > 0) {
        sel.modify("extend", "backward", "character");
        text = sel.toString();
        trimmed = true;
      }

      if (trimmed) window.PowerSuite.log("Trimmed trailing space.", "success");
    }, 10); // 10ms delay makes keyboard trimming virtually instant
  });

  // ==========================================
  // FEATURE 2: OBSIDIAN STYLE BOLD/ITALIC
  // ==========================================
  const getDOMMap = (block) => {
    let text = "";
    let nodes = [];
    const walker = document.createTreeWalker(
      block,
      NodeFilter.SHOW_ALL,
      null,
      false,
    );
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) {
        nodes.push({
          node: n,
          start: text.length,
          end: text.length + n.nodeValue.length,
        });
        text += n.nodeValue;
      } else if (
        n.nodeName === "BR" ||
        n.nodeName === "DIV" ||
        n.nodeName === "P"
      ) {
        if (text.length > 0 && text[text.length - 1] !== " ") {
          text += " ";
        }
      }
    }
    return { text, nodes };
  };

  const setMappedSelection = (sel, nodes, absStart, absEnd) => {
    let startNode,
      startOff = 0,
      endNode,
      endOff = 0;
    for (const item of nodes) {
      if (!startNode && absStart <= item.end) {
        startNode = item.node;
        startOff = Math.max(0, absStart - item.start);
      }
      if (!endNode && absEnd <= item.end) {
        endNode = item.node;
        endOff = Math.max(0, absEnd - item.start);
        break;
      }
    }
    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, startOff);
      range.setEnd(endNode, endOff);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  document.addEventListener(
    "keydown",
    (e) => {
      const isBold = e.key.toLowerCase() === "b";
      const isItalic = e.key.toLowerCase() === "i";
      const isUnderline = e.key.toLowerCase() === "u";

      if (!e.ctrlKey || (!isBold && !isItalic && !isUnderline)) return;
      if (window.PowerSuite.isProcessing) return;

      const editableRoot = window.PowerSuite.getEditableRoot();
      if (!editableRoot) return;

      const rootNode = editableRoot.getRootNode();
      const sel = rootNode.getSelection
        ? rootNode.getSelection()
        : window.getSelection();

      if (!sel || sel.rangeCount === 0) return;

      if (!sel.getRangeAt(0).collapsed || sel.toString().length > 0) return;

      let targetNode = sel.anchorNode;
      let targetOffset = sel.anchorOffset;

      if (targetNode.nodeType !== Node.TEXT_NODE) {
        if (targetNode.childNodes.length > targetOffset) {
          targetNode = targetNode.childNodes[targetOffset];
          targetOffset = 0;
        } else if (targetNode.childNodes.length > 0) {
          targetNode = targetNode.childNodes[targetNode.childNodes.length - 1];
          targetOffset = targetNode.textContent.length;
        }
        while (targetNode && targetNode.nodeType !== Node.TEXT_NODE) {
          targetNode = targetNode.firstChild || targetNode;
          if (targetNode === targetNode.parentNode) break;
        }
      }
      if (targetNode.nodeType !== Node.TEXT_NODE) return;

      let block = targetNode;
      while (
        block &&
        block !== editableRoot &&
        !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
          block.nodeName.toUpperCase(),
        )
      ) {
        block = block.parentNode;
      }
      if (!block) block = editableRoot;

      const { text, nodes } = getDOMMap(block);

      let absOffset = -1;
      for (const item of nodes) {
        if (item.node === targetNode) {
          absOffset = item.start + targetOffset;
          break;
        }
      }
      if (absOffset === -1) return;

      const isWordChar = (char) => char && /[\p{L}\p{N}_]/u.test(char);

      let start = absOffset;
      while (start > 0 && isWordChar(text[start - 1])) start--;

      let end = absOffset;
      while (end < text.length && isWordChar(text[end])) end++;

      if (start === end) return;

      e.preventDefault();
      window.PowerSuite.isProcessing = true;

      try {
        setMappedSelection(sel, nodes, start, end);

        let command = "bold";
        if (isItalic) command = "italic";
        if (isUnderline) command = "underline";
        document.execCommand(command, false, null);

        editableRoot.dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true }),
        );

        const newMap = getDOMMap(block);
        setMappedSelection(sel, newMap.nodes, absOffset, absOffset);

        window.PowerSuite.log(`Applied Obsidian-style ${command}.`, "success");
      } catch (err) {
        window.PowerSuite.log(`Smart Format Error: ${err}`, "error");
      } finally {
        window.PowerSuite.isProcessing = false;
      }
    },
    true,
  );
};

window.PowerSuite.initPassiveListeners();
