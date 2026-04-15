// feature_auto_indent.js
window.PowerSuite.initAutoIndent = function () {
  if (window.PowerSuite._autoIndentInitialized) return;
  window.PowerSuite._autoIndentInitialized = true;

  window.PowerSuite.log("Initializing Auto-Indent Engine...", "info");

  document.addEventListener(
    "keydown",
    (e) => {
      // --- SYNCHRONOUS HIJACK: Ctrl+Shift+Right (Wall-Breaker) ---
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

      // --- AUTO-INDENT ON ENTER (Live DOM Tracking Engine) ---
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
    },
    true,
  );
};
window.PowerSuite.initAutoIndent();
