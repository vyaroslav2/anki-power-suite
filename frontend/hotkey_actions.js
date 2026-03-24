// ==========================================
// 1. LINE FORMATTER (Alt+Shift+Q)
// ==========================================
window.PowerSuite.formatCurrentLine = function () {
  if (window.PowerSuite.isProcessing) {
    window.PowerSuite.log("System is busy. Ignoring format request.", "warn");
    return;
  }

  const editableRoot = window.PowerSuite.getEditableRoot();
  if (!editableRoot) return;

  window.PowerSuite.isProcessing = true;

  try {
    const indent = "\u00A0\u00A0\u00A0\u00A0";
    const indentRegex = /^(?:<span[^>]*><\/span>)*(?:\s|&nbsp;|\u00A0){4}/i;

    const rootNode = editableRoot.getRootNode();
    const sel = rootNode.getSelection
      ? rootNode.getSelection()
      : window.getSelection();
    if (!sel || !sel.rangeCount) {
      window.PowerSuite.isProcessing = false;
      return;
    }

    const range = sel.getRangeAt(0);
    const startMarker = document.createElement("span");
    startMarker.className = "anki-fmt-start";
    const endMarker = document.createElement("span");
    endMarker.className = "anki-fmt-end";

    const sRange = range.cloneRange();
    sRange.collapse(true);
    sRange.insertNode(startMarker);
    const eRange = range.cloneRange();
    eRange.collapse(false);
    eRange.insertNode(endMarker);

    function normalize(root) {
      let allNodes = [];
      const process = (nodes) => {
        Array.from(nodes).forEach((node) => {
          if (node.nodeName === "DIV" || node.nodeName === "P") {
            if (
              allNodes.length > 0 &&
              allNodes[allNodes.length - 1].nodeName !== "BR"
            ) {
              allNodes.push(document.createElement("br"));
            }
            process(node.childNodes);
            if (
              allNodes.length > 0 &&
              allNodes[allNodes.length - 1].nodeName !== "BR"
            ) {
              allNodes.push(document.createElement("br"));
            }
          } else {
            allNodes.push(node);
          }
        });
      };
      process(root.childNodes);

      root.innerHTML = "";
      let currentDiv = document.createElement("div");
      currentDiv.style.margin = "0";
      root.appendChild(currentDiv);

      allNodes.forEach((node, index) => {
        if (node.nodeName === "BR") {
          if (currentDiv.childNodes.length === 0) currentDiv.innerHTML = "<br>";
          if (index < allNodes.length - 1) {
            currentDiv = document.createElement("div");
            currentDiv.style.margin = "0";
            root.appendChild(currentDiv);
          }
        } else {
          currentDiv.appendChild(node);
        }
      });

      root.querySelectorAll("div").forEach((div) => {
        if (div.innerHTML.trim() === "") div.innerHTML = "<br>";
      });

      root.querySelectorAll("b, i").forEach((el) => {
        if (el.innerText.trim() === "" && !el.querySelector("span"))
          el.remove();
      });
    }

    normalize(editableRoot);

    const sMarker = editableRoot.querySelector(".anki-fmt-start");
    const eMarker = editableRoot.querySelector(".anki-fmt-end");
    if (!sMarker || !eMarker)
      throw new Error("Markers lost during normalization");

    const getLine = (n) =>
      n && n.parentNode === editableRoot ? n : getLine(n.parentNode);
    const allLines = Array.from(editableRoot.childNodes);
    let low = allLines.indexOf(getLine(sMarker));
    let high = allLines.indexOf(getLine(eMarker));
    if (low > high) [low, high] = [high, low];

    const scope = allLines.slice(low, high + 1);

    if (scope.some((line) => line.innerHTML.includes("{{c"))) {
      window.PowerSuite.log(
        "Cloze deletion detected. Aborting format.",
        "warn",
      );
      window.PowerSuite.isProcessing = false;
      return;
    }

    const refLine =
      scope.find((l) => l.innerText.trim().length > 0) || scope[0];
    const hasIndent = indentRegex.test(refLine.innerHTML);
    const hasItalics = refLine.querySelector("i") !== null;
    const shouldUnformat =
      (hasIndent && hasItalics) || refLine.dataset.ankiFmt === "1";

    scope.forEach((line) => {
      if (line.nodeType !== 1) return;

      const visibleText = line.innerText.trim();
      const isBlank = visibleText.length === 0;

      let html = line.innerHTML;
      let lastHtml = "";

      while (html !== lastHtml) {
        lastHtml = html;
        html = html.replace(
          /^((?:<span class="anki-fmt-(?:start|end)"><\/span>)*)(?:\s|&nbsp;|\u00A0)+/gi,
          "$1",
        );
        html = html.replace(/<\/?i>/gi, "");
      }

      if (!shouldUnformat) {
        if (!isBlank) {
          line.innerHTML = `${indent}<i>${html}</i>`;
          line.dataset.ankiFmt = "1";
        } else {
          line.innerHTML = html;
        }
      } else {
        line.innerHTML = html;
        delete line.dataset.ankiFmt;
      }

      if (line.innerHTML.trim() === "") line.innerHTML = "<br>";
    });

    const finalStart = editableRoot.querySelector(".anki-fmt-start");
    const finalEnd = editableRoot.querySelector(".anki-fmt-end");
    if (finalStart && finalEnd) {
      const finalRange = document.createRange();
      finalRange.setStartAfter(finalStart);
      finalRange.setEndBefore(finalEnd);
      sel.removeAllRanges();
      sel.addRange(finalRange);
    }
  } catch (e) {
    window.PowerSuite.log("FORMATTER ERROR: " + e, "error");
  } finally {
    editableRoot
      .querySelectorAll(".anki-fmt-start, .anki-fmt-end")
      .forEach((m) => m.remove());
    editableRoot.focus();
    window.PowerSuite.isProcessing = false; // ALWAYS UNLOCK
  }
};

// ==========================================
// 2. AI TRANSLATOR (F8 / Ctrl+F10)
// ==========================================
window.PowerSuite.aiGetText = function () {
  if (window.PowerSuite.isProcessing) {
    window.PowerSuite.log("System is busy. Ignoring AI request.", "warn");
    return "";
  }

  const activeEl = window.PowerSuite.getEditableRoot();
  if (!activeEl) return "";

  window.PowerSuite.isProcessing = true; // LOCK
  window.PowerSuite.aiActiveElement = activeEl;

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();

  if (!sel || !sel.rangeCount) {
    window.PowerSuite.isProcessing = false;
    return "";
  }

  let extractedText = sel.toString();

  if (extractedText.trim().length === 0) {
    let anchor = sel.anchorNode;
    if (!anchor) {
      window.PowerSuite.isProcessing = false;
      return "";
    }

    let blockElement = anchor.nodeType === 3 ? anchor.parentNode : anchor;
    while (
      blockElement &&
      blockElement !== activeEl &&
      !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
        blockElement.nodeName.toUpperCase(),
      )
    ) {
      blockElement = blockElement.parentNode;
    }
    if (!blockElement) blockElement = activeEl;

    const range = document.createRange();
    range.selectNodeContents(blockElement);
    sel.removeAllRanges();
    sel.addRange(range);

    extractedText = sel.toString();
  }

  if (extractedText.trim().length === 0) {
    window.PowerSuite.isProcessing = false;
    return "";
  }

  const leadingMatch = extractedText.match(/^[\s\u00A0]+/);
  const prefix = leadingMatch ? leadingMatch[0] : "";
  const trailingMatch = extractedText.match(/[\s\u00A0]+$/);
  const suffix = trailingMatch ? trailingMatch[0] : "";
  const cleanText = extractedText.trim();

  window.PowerSuite.aiToken = "[[AI_TRANSLATING_" + Date.now() + "]]";
  const skeleton = `${prefix}{{c1::${cleanText}::${window.PowerSuite.aiToken}}}${suffix}`;

  document.execCommand("removeFormat", false, null);
  document.execCommand("insertText", false, skeleton);

  window.PowerSuite.log("AI Placeholder injected.", "info");
  return cleanText;
};

window.PowerSuite.aiInjectCloze = function (translated) {
  const activeEl = window.PowerSuite.aiActiveElement;
  const token = window.PowerSuite.aiToken;

  if (!activeEl || !token) {
    window.PowerSuite.log("Missing active element or token.", "error");
    window.PowerSuite.isProcessing = false;
    return false;
  }

  const root = activeEl.shadowRoot || activeEl;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  let found = false;
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.includes(token)) {
      node.nodeValue = node.nodeValue.replace(token, translated);
      found = true;
      break;
    }
  }

  if (!found) {
    window.PowerSuite.log("TreeWalker missed token, using fallback.", "warn");
    root.innerHTML = root.innerHTML.replace(token, translated);
  }

  activeEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  window.PowerSuite.log("Translation injected successfully.", "success");

  // CLEANUP & UNLOCK
  window.PowerSuite.aiActiveElement = null;
  window.PowerSuite.aiToken = null;
  window.PowerSuite.isProcessing = false;

  return true;
};
