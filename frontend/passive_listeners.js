//passive_listeners.js
window.PowerSuite.initPassiveListeners = function () {
  if (window.PowerSuite._listenersInitialized) return;
  window.PowerSuite._listenersInitialized = true;

  window.PowerSuite.log(
    "Initializing Smart Editor (Unified Final Engine)...",
    "info",
  );

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

  // ==========================================
  // FEATURE 2: DOM MAPPING ENGINE
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
        if (text.length > 0 && text[text.length - 1] !== " ") text += " ";
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

  // ==========================================
  // MAIN KEYBOARD CONTROLLER
  // ==========================================
  document.addEventListener(
    "keydown",
    (e) => {
      // --- 1. SYNCHRONOUS HIJACK: Ctrl+Shift+Right (Wall-Breaker) ---
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        if (window.PowerSuite.isProcessing) return;
        const editableRoot = window.PowerSuite.getEditableRoot();
        if (!editableRoot) return;
        const rootNode = editableRoot.getRootNode();
        const sel = rootNode.getSelection
          ? rootNode.getSelection()
          : window.getSelection();
        if (!sel) return;

        e.preventDefault();
        lastSelectionSource = "keyboard_hijack";

        const prevText = sel.toString();
        sel.modify("extend", "forward", "word");

        let loopProtect = 10;
        while (
          sel.toString().length > prevText.length &&
          /^[\s\u00A0]*$/.test(sel.toString().slice(prevText.length)) &&
          loopProtect-- > 0
        ) {
          sel.modify("extend", "forward", "word");
        }

        let text = sel.toString();
        let sanity = 10;
        while (text.length > 0 && /[\s\u00A0]$/.test(text) && sanity-- > 0) {
          sel.modify("extend", "backward", "character");
          text = sel.toString();
        }
        return;
      }

      if (e.shiftKey || e.key.includes("Arrow")) {
        lastSelectionSource = "keyboard";
      }

      // --- 3. AUTO-INDENT ON ENTER (Live DOM Tracking Engine) ---
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (window.PowerSuite.isProcessing) return;

        const editableRoot = window.PowerSuite.getEditableRoot();
        if (!editableRoot) return;

        const rootNode = editableRoot.getRootNode();
        const sel = rootNode.getSelection
          ? rootNode.getSelection()
          : window.getSelection();

        if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed)
          return;

        // Ensure cursor is actually inside the active editable area
        if (!editableRoot.contains(sel.anchorNode)) return;

        // Respect native list indentation
        let node = sel.anchorNode;
        let inList = false;
        while (node && node !== editableRoot) {
          if (["LI", "UL", "OL"].includes(node.nodeName.toUpperCase())) {
            inList = true;
            break;
          }
          node = node.parentNode;
        }
        if (inList) return;

        try {
          // STEP 1: Normalize Cursor Position
          let targetNode = sel.anchorNode;
          let targetOffset = sel.anchorOffset;
          let isElementAnchor = targetNode.nodeType === Node.ELEMENT_NODE;
          let childNodeAtCursor = null;

          if (isElementAnchor) {
            if (targetOffset < targetNode.childNodes.length) {
              childNodeAtCursor = targetNode.childNodes[targetOffset];
            } else {
              childNodeAtCursor = "END";
            }
          }

          // STEP 2: Find the Line Container
          let block = targetNode;
          while (
            block &&
            block !== editableRoot &&
            !["DIV", "P", "LI", "BLOCKQUOTE", "TD", "TH"].includes(
              block.nodeName.toUpperCase(),
            )
          ) {
            block = block.parentNode;
          }
          if (!block) block = editableRoot;

          // STEP 3: Walk the Live DOM strictly inside the line container
          const walker = document.createTreeWalker(
            block,
            NodeFilter.SHOW_ALL,
            null,
            false,
          );
          let n;

          let beforeText = "";
          let afterText = "";
          let foundCursor = false;

          while ((n = walker.nextNode())) {
            let tag = n.nodeName ? n.nodeName.toUpperCase() : "";

            // Detect native line breaks inside the block
            if (tag === "BR" || tag === "DIV" || tag === "P" || tag === "LI") {
              if (foundCursor) break;
              else beforeText = ""; // Reset, cursor is on a newer line
            } else if (n.nodeType === Node.TEXT_NODE) {
              if (!foundCursor && !isElementAnchor && n === targetNode) {
                foundCursor = true;
                beforeText += n.nodeValue.substring(0, targetOffset);
                afterText += n.nodeValue.substring(targetOffset);
              } else if (
                !foundCursor &&
                isElementAnchor &&
                n === childNodeAtCursor
              ) {
                foundCursor = true;
                afterText += n.nodeValue;
              } else {
                if (foundCursor) afterText += n.nodeValue;
                else beforeText += n.nodeValue;
              }
            } else {
              // It's an element tag (like <i> or <b>). Check if the cursor is exactly here.
              if (!foundCursor && isElementAnchor && n === childNodeAtCursor) {
                foundCursor = true;
              }
            }
          }

          // Fallback for cursor at the very end of an element
          if (!foundCursor) foundCursor = true;

          // STEP 4: Evaluate Rules based on our exact text matches
          const isBeforeOnlySpaces = /^[\s\u00A0]*$/.test(beforeText);
          const hasTextAfter = /[^\s\u00A0]/.test(afterText);
          const hasSpaces = beforeText.length > 0;

          // STEP 5: Trigger the Override
          if (isBeforeOnlySpaces && hasTextAfter && hasSpaces) {
            e.preventDefault();
            e.stopPropagation(); // Stop Anki from fighting us
            e.stopImmediatePropagation();
            window.PowerSuite.isProcessing = true;

            if (e.shiftKey) {
              document.execCommand("insertLineBreak", false);
            } else {
              document.execCommand("insertParagraph", false);
            }

            document.execCommand("insertText", false, beforeText);

            editableRoot.dispatchEvent(
              new InputEvent("input", { bubbles: true, composed: true }),
            );
            window.PowerSuite.isProcessing = false;
          }
        } catch (err) {
          window.PowerSuite.isProcessing = false;
          window.PowerSuite.log(`Auto-Indent Error: ${err}`, "error");
        }
      }

      // --- 4. OBSIDIAN FORMATTING TOGGLES ---
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
