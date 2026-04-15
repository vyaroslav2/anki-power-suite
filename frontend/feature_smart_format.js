// feature_smart_format.js
window.PowerSuite.initSmartFormat = function () {
  if (window.PowerSuite._smartFormatInitialized) return;
  window.PowerSuite._smartFormatInitialized = true;

  window.PowerSuite.log("Initializing Smart Format Engine...", "info");

  // ==========================================
  // DOM MAPPING ENGINE
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

  document.addEventListener(
    "keydown",
    (e) => {
      // --- OBSIDIAN FORMATTING TOGGLES ---
      const isBold = e.key.toLowerCase() === "b";
      const isItalic = e.key.toLowerCase() === "i";
      const isUnderline = e.key.toLowerCase() === "u";

      if (e.ctrlKey || e.metaKey) {
        if (isBold || isItalic || isUnderline) {
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
              targetNode =
                targetNode.childNodes[targetNode.childNodes.length - 1];
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

            window.PowerSuite.log(
              `Applied Obsidian-style ${command}.`,
              "success",
            );
          } catch (err) {
            window.PowerSuite.log(`Smart Format Error: ${err}`, "error");
          } finally {
            window.PowerSuite.isProcessing = false;
          }
        }
      }

      // --- VS CODE STYLE LINE CUT (Ctrl+X without selection) ---
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "x" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        if (window.PowerSuite.isProcessing) return;

        const editableRoot = window.PowerSuite.getEditableRoot();
        if (!editableRoot) return;

        const rootNode = editableRoot.getRootNode();
        const sel = rootNode.getSelection
          ? rootNode.getSelection()
          : window.getSelection();

        // Only trigger if NO text is currently highlighted
        if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
          let target = sel.anchorNode;
          if (!target) return;

          let blockElement =
            target.nodeType === Node.TEXT_NODE ? target.parentNode : target;

          while (
            blockElement &&
            blockElement !== editableRoot &&
            !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
              blockElement.nodeName.toUpperCase(),
            )
          ) {
            blockElement = blockElement.parentNode;
          }

          if (blockElement && blockElement !== editableRoot) {
            const range = document.createRange();
            range.selectNode(blockElement); // Highlight the entire line block instantly
            sel.removeAllRanges();
            sel.addRange(range);

            window.PowerSuite.log(
              "Line selected for VS Code style Cut.",
              "info",
            );

            // CRITICAL: We do NOT call e.preventDefault() here!
            // We exit and let the browser's native Cut command execute on our new selection.
            // This copies it to the clipboard and perfectly ties into Anki's native Ctrl+Z stack!
            return;
          }
        }
      }
    },
    true,
  );
};
window.PowerSuite.initSmartFormat();
