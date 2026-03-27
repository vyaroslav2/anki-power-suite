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
  let sel;

  try {
    const indent = "\u00A0\u00A0\u00A0\u00A0";
    const indentRegex = /^(?:<span[^>]*><\/span>)*(?:\s|&nbsp;|\u00A0){4}/i;

    const rootNode = editableRoot.getRootNode();
    sel = rootNode.getSelection
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

    if (scope.some((line) => line.textContent.includes("{{c"))) {
      throw new Error("CLOZE_ABORT");
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
  } catch (e) {
    if (e.message === "CLOZE_ABORT") {
      window.PowerSuite.log(
        "Cloze deletion detected. Aborting format.",
        "warn",
      );
    } else {
      window.PowerSuite.log("FORMATTER ERROR: " + e, "error");
    }
  } finally {
    const finalStart = editableRoot.querySelector(".anki-fmt-start");
    const finalEnd = editableRoot.querySelector(".anki-fmt-end");
    if (finalStart && finalEnd && sel) {
      try {
        const finalRange = document.createRange();
        finalRange.setStartAfter(finalStart);
        finalRange.setEndBefore(finalEnd);
        sel.removeAllRanges();
        sel.addRange(finalRange);
      } catch (err) {}
    }

    editableRoot
      .querySelectorAll(".anki-fmt-start, .anki-fmt-end")
      .forEach((m) => m.remove());
    editableRoot.focus();
    window.PowerSuite.isProcessing = false;
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

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();

  if (!sel || !sel.rangeCount) return "";

  let extractedText = sel.toString();
  let isAutoExpanded = false;
  let anchor = sel.anchorNode;

  if (!anchor) return "";

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

  // AUTO-EXPAND
  if (extractedText.trim().length === 0) {
    isAutoExpanded = true;
    const range = document.createRange();
    range.selectNodeContents(blockElement);
    sel.removeAllRanges();
    sel.addRange(range);
    extractedText = sel.toString();
  }

  if (extractedText.trim().length === 0) return "";

  // EDGE CASE PROTECTIONS (Blocks nested cloze bugs)
  let preText = "";
  try {
    const preRange = document.createRange();
    preRange.setStart(blockElement, 0);
    preRange.setEnd(
      sel.getRangeAt(0).startContainer,
      sel.getRangeAt(0).startOffset,
    );
    preText = preRange.toString();
  } catch (e) {}

  const openCount = (preText.match(/\{\{c\d+::/g) || []).length;
  const closeCount = (preText.match(/\}\}/g) || []).length;

  if (openCount > closeCount) {
    window.PowerSuite.log(
      "Selection inside an existing cloze. Ignoring.",
      "warn",
    );
    return "";
  }
  if (extractedText.includes("{{c") || extractedText.includes("}}")) {
    window.PowerSuite.log(
      "Selection contains cloze formatting. Ignoring.",
      "warn",
    );
    return "";
  }
  if (isAutoExpanded && blockElement.textContent.includes("{{c")) {
    window.PowerSuite.log("Line already contains a cloze. Ignoring.", "warn");
    return "";
  }

  window.PowerSuite.isProcessing = true; // LOCK
  window.PowerSuite.aiActiveElement = activeEl;

  let targetForCloze = extractedText;
  let leftover = "";

  if (isAutoExpanded) {
    const splitMatch = extractedText.match(/^([\s\S]*?)(\s*)(\([\s\S]*)$/);
    if (splitMatch && splitMatch[1].trim().length > 0) {
      targetForCloze = splitMatch[1];
      leftover = splitMatch[2] + splitMatch[3];
    }
  }

  const leadingMatch = targetForCloze.match(/^[\s\u00A0]+/);
  const prefix = leadingMatch ? leadingMatch[0] : "";
  const trailingMatch = targetForCloze.match(/[\s\u00A0]+$/);
  const suffix = trailingMatch ? trailingMatch[0] : "";
  const cleanText = targetForCloze.trim();

  window.PowerSuite.aiToken = "[[AI_TRANSLATING_" + Date.now() + "]]";
  const skeleton = `${prefix}{{c1::${cleanText}::${window.PowerSuite.aiToken}}}${suffix}${leftover}`;

  // ExecCommand + Notify Anki UI of change (Saves Main Field Undo History)
  document.execCommand("insertText", false, skeleton);
  activeEl.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );

  window.PowerSuite.log("AI Placeholder injected.", "info");
  return cleanText;
};

window.PowerSuite.aiInjectCloze = function (translated, isCombo) {
  // If the user aborted during generation, Traffic Cop will block silent pastes
  if (!window.PowerSuite.isProcessing || !window.PowerSuite.aiToken) {
    window.PowerSuite.log("Task was aborted. Ignoring AI response.", "warn");
    return false;
  }

  const activeEl = window.PowerSuite.aiActiveElement;
  const token = window.PowerSuite.aiToken;
  if (!activeEl) return false;

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();

  const root = activeEl.shadowRoot || activeEl;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  let targetNode = null;
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.includes(token)) {
      targetNode = node;
      break;
    }
  }

  if (targetNode) {
    const range = document.createRange();
    const startIdx = targetNode.nodeValue.indexOf(token);
    range.setStart(targetNode, startIdx);
    range.setEnd(targetNode, startIdx + token.length);
    sel.removeAllRanges();
    sel.addRange(range);

    // Inject and notify Anki
    document.execCommand("insertText", false, translated);
    activeEl.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true }),
    );

    window.PowerSuite.log("Translation injected.", "success");
  } else {
    window.PowerSuite.log("Token not found.", "error");
    return false;
  }

  window.PowerSuite.aiActiveElement = null;
  window.PowerSuite.aiToken = null;

  if (!isCombo) {
    window.PowerSuite.isProcessing = false;
  }
  return true;
};

// ==========================================
// 3. TTS PIPELINE (F9 / Combo)
// ==========================================
window.PowerSuite.ttsGetText = function () {
  if (window.PowerSuite.isProcessing) return "";

  const activeEl = window.PowerSuite.getEditableRoot();
  if (!activeEl) return "";

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();
  if (!sel || !sel.rangeCount) return "";

  let extractedText = sel.toString();
  let isAutoExpanded = false;
  let anchor = sel.anchorNode;

  if (!anchor) return "";

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

  if (!extractedText.trim()) {
    isAutoExpanded = true;
    extractedText = blockElement.innerText || blockElement.textContent || "";
  }
  if (!extractedText.trim()) return "";

  // EDGE CASE PROTECTIONS
  let preText = "";
  try {
    const preRange = document.createRange();
    preRange.setStart(blockElement, 0);
    preRange.setEnd(
      sel.getRangeAt(0).startContainer,
      sel.getRangeAt(0).startOffset,
    );
    preText = preRange.toString();
  } catch (e) {}

  const openCount = (preText.match(/\{\{c\d+::/g) || []).length;
  const closeCount = (preText.match(/\}\}/g) || []).length;

  if (
    openCount > closeCount ||
    extractedText.includes("{{c") ||
    extractedText.includes("}}") ||
    (isAutoExpanded && blockElement.textContent.includes("{{c"))
  ) {
    return "";
  }

  let filteredText = extractedText.replace(/\([^)]*\)/g, " ");
  filteredText = filteredText.replace(/\s{2,}/g, " ").trim();

  if (!filteredText) return "";

  window.PowerSuite.isProcessing = true; // LOCK
  window.PowerSuite.log("TTS Text extracted successfully.", "info");
  return filteredText;
};

window.PowerSuite.ttsInjectAudio = function (filename, targetIndex) {
  if (!window.PowerSuite.isProcessing) {
    window.PowerSuite.log("Task aborted. Ignoring Audio response.", "warn");
    return false;
  }

  function getAllEditableFields(root) {
    const results = [];
    root.querySelectorAll('[contenteditable="true"], .field').forEach((el) => {
      if (!results.includes(el)) results.push(el);
    });
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) {
        getAllEditableFields(el.shadowRoot).forEach((hit) => {
          if (!results.includes(hit)) results.push(hit);
        });
      }
    });
    return results;
  }

  const editables = getAllEditableFields(document).filter(
    (el) =>
      el.getAttribute("contenteditable") === "true" ||
      el.classList.contains("editable"),
  );

  if (editables.length === 0 || targetIndex >= editables.length) {
    window.PowerSuite.isProcessing = false;
    return false;
  }

  const targetField = editables[targetIndex];

  // ==========================================
  // FIXED: RESTORED INNERHTML BACKGROUND INJECTION
  // This prevents cursor jumping and selection loss completely.
  // ==========================================
  let currentHtml = targetField.innerHTML || "";
  currentHtml = currentHtml.replace(/(<br\s*\/?>|\s)+$/gi, "");
  targetField.innerHTML = currentHtml + ` [sound:${filename}]`;

  // Notify Anki UI of the shadow DOM state change
  targetField.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  targetField.dispatchEvent(
    new Event("change", { bubbles: true, composed: true }),
  );

  window.PowerSuite.log("Audio injected silently in background.", "success");
  window.PowerSuite.isProcessing = false; // UNLOCK!
  return true;
};

// ==========================================
// 4. CLOZE UNWRAPPER / ABORT TRIGGER
// ==========================================
window.PowerSuite.unwrapCloze = function () {
  let wasAborting = false;
  let tokenToKill = window.PowerSuite.aiToken;

  // 1. Act as an Instant Abort Button if the script is running
  if (window.PowerSuite.isProcessing) {
    wasAborting = true;
    window.PowerSuite.isProcessing = false;
    window.PowerSuite.aiToken = null;
  }

  const activeEl = window.PowerSuite.getEditableRoot();
  if (!activeEl) return wasAborting ? "ABORTED" : "IGNORED";

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();
  if (!sel) return wasAborting ? "ABORTED" : "IGNORED";

  let actionResult = "IGNORED";

  const unwrapBlock = (block) => {
    const html = block.innerHTML;
    const unwrapRegex = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g;
    if (unwrapRegex.test(html)) {
      const range = document.createRange();
      range.selectNodeContents(block);
      sel.removeAllRanges();
      sel.addRange(range);

      document.execCommand(
        "insertHTML",
        false,
        html.replace(unwrapRegex, "$1"),
      );
      block.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true }),
      );
      return true;
    }
    return false;
  };

  // 2. Unwrapping Text Focus
  let anchor = sel.anchorNode;
  if (anchor) {
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

    if (unwrapBlock(blockElement)) {
      actionResult = "UNWRAPPED";
    }
  }

  // Global Seek-and-Destroy (In case user clicked away before hitting Abort)
  if (wasAborting && tokenToKill && actionResult === "IGNORED") {
    const walker = document.createTreeWalker(
      activeEl.shadowRoot || activeEl,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.includes(tokenToKill)) {
        let p = n.parentNode;
        while (
          p &&
          p !== activeEl &&
          !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
            p.nodeName.toUpperCase(),
          )
        ) {
          p = p.parentNode;
        }
        if (p && unwrapBlock(p)) actionResult = "UNWRAPPED";
        break;
      }
    }
  }

  // 3. Audio Cleanup (Combo Mapping Sync)
  if (!wasAborting && actionResult === "UNWRAPPED") {
    function getAllEditableFields(root) {
      const results = [];
      root
        .querySelectorAll('[contenteditable="true"], .field')
        .forEach((el) => results.push(el));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot)
          getAllEditableFields(el.shadowRoot).forEach((hit) =>
            results.push(hit),
          );
      });
      return results;
    }

    const editables = getAllEditableFields(document).filter(
      (el) =>
        el.getAttribute("contenteditable") === "true" ||
        el.classList.contains("editable"),
    );

    for (let i = editables.length - 1; i >= 0; i--) {
      let fieldHtml = editables[i].innerHTML;
      const audioRegex = /\[sound:eleven_[a-f0-9]+\.mp3\](?=[^\[]*$)/;

      if (audioRegex.test(fieldHtml)) {
        // ==========================================
        // FIXED: RESTORED INNERHTML BACKGROUND REMOVAL
        // Prevents unwrapping from breaking cursor.
        // ==========================================
        editables[i].innerHTML = fieldHtml.replace(audioRegex, "");
        editables[i].dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true }),
        );

        window.PowerSuite.log("Removed orphaned audio tag silently.", "info");
        actionResult = "UNWRAPPED_WITH_AUDIO";
        break; // Only remove one tag per unwrap
      }
    }
  }

  if (wasAborting) return "ABORTED";

  if (actionResult.startsWith("UNWRAPPED")) {
    window.PowerSuite.log("Cloze unwrapped successfully.", "success");
  }
  return actionResult;
};
