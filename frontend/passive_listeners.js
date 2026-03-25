window.PowerSuite.initPassiveListeners = function () {
  if (window.PowerSuite._listenersInitialized) return;
  window.PowerSuite._listenersInitialized = true;

  window.PowerSuite.log(
    "Initializing Smart Editor (Array Mapping Engine)...",
    "info",
  );

  // ==========================================
  // FEATURE 1: NO TRAILING SPACE ON SELECTION
  // ==========================================
  let trimTimeout;
  document.addEventListener("selectionchange", () => {
    if (window.PowerSuite.isProcessing) return;

    clearTimeout(trimTimeout);
    trimTimeout = setTimeout(() => {
      if (window.PowerSuite.isProcessing) return;

      const editableRoot = window.PowerSuite.getEditableRoot();
      if (!editableRoot) return;

      const rootNode = editableRoot.getRootNode();
      const sel = rootNode.getSelection
        ? rootNode.getSelection()
        : window.getSelection();

      if (!sel || sel.rangeCount === 0) return;
      if (sel.getRangeAt(0).collapsed) return;

      let text = sel.toString();
      // If it's pure spaces, or a large multi-word selection (like Ctrl+A), LEAVE IT ALONE!
      if (/^[\s\u00A0]+$/.test(text) || text.trim().includes(" ")) return;

      let trimmed = false;
      let sanity = 10;
      while (text.length > 0 && /[\s\u00A0]$/.test(text) && sanity-- > 0) {
        sel.modify("extend", "backward", "character");
        text = sel.toString();
        trimmed = true;
      }

      if (trimmed) window.PowerSuite.log("Trimmed trailing space.", "success");
    }, 50);
  });

  // ==========================================
  // FEATURE 2: OBSIDIAN STYLE BOLD/ITALIC
  // ==========================================
  // Creates a seamless coordinate map of the DOM
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

      // BULLETPROOF FIX: If user highlighted ANYTHING intentionally, abort perfectly!
      if (!sel.getRangeAt(0).collapsed || sel.toString().length > 0) return;

      let targetNode = sel.anchorNode;
      let targetOffset = sel.anchorOffset;

      // TOGGLE TRAP FIX: If cursor is resting on an HTML Element instead of text, drill down to the text!
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

      // Get paragraph block
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

      // 1. Build coordinate map
      const { text, nodes } = getDOMMap(block);

      // Find cursor coordinate
      let absOffset = -1;
      for (const item of nodes) {
        if (item.node === targetNode) {
          absOffset = item.start + targetOffset;
          break;
        }
      }
      if (absOffset === -1) return;

      // 2. Do the math
      const isWordChar = (char) => char && /[\p{L}\p{N}_]/u.test(char);

      let start = absOffset;
      while (start > 0 && isWordChar(text[start - 1])) start--;

      let end = absOffset;
      while (end < text.length && isWordChar(text[end])) end++;

      // If cursor is floating in space, let Anki natively format the next typed word
      if (start === end) return;

      e.preventDefault();
      window.PowerSuite.isProcessing = true; // LOCK

      try {
        // 3. Highlight exactly using coordinates
        setMappedSelection(sel, nodes, start, end);

        // 4. Format
        let command = "bold";
        if (isItalic) command = "italic";
        if (isUnderline) command = "underline";
        document.execCommand(command, false, null);

        // 5. Save changes
        editableRoot.dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true }),
        );

        // 6. Restore Cursor EXACTLY where it was using a fresh map of the new DOM
        const newMap = getDOMMap(block);
        setMappedSelection(sel, newMap.nodes, absOffset, absOffset);

        window.PowerSuite.log(`Applied Obsidian-style ${command}.`, "success");
      } catch (err) {
        window.PowerSuite.log(`Smart Format Error: ${err}`, "error");
      } finally {
        window.PowerSuite.isProcessing = false; // UNLOCK
      }
    },
    true,
  );
};

window.PowerSuite.initPassiveListeners();
