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
  let sel; // Declare selection outside so the finally block can use it

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

    // FIX 2: Use textContent instead of innerHTML so HTML markers don't split the {{c
    if (scope.some((line) => line.textContent.includes("{{c"))) {
      // Throw a specific error so we skip formatting, but still hit the finally block
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
    // FIX 1: Restore the cursor BEFORE deleting the markers, no matter what happened
    const finalStart = editableRoot.querySelector(".anki-fmt-start");
    const finalEnd = editableRoot.querySelector(".anki-fmt-end");
    if (finalStart && finalEnd && sel) {
      try {
        const finalRange = document.createRange();
        finalRange.setStartAfter(finalStart);
        finalRange.setEndBefore(finalEnd);
        sel.removeAllRanges();
        sel.addRange(finalRange);
      } catch (err) {
        // Silently ignore if range can't be restored
      }
    }

    // Now safely remove the markers
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
  let isAutoExpanded = false;

  // AUTO-EXPAND IF CURSOR IS JUST PLACED ON A LINE
  if (extractedText.trim().length === 0) {
    isAutoExpanded = true;
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

  // --- NEW LOGIC: SMART PARENTHESES SPLITTING ---
  let targetForCloze = extractedText;
  let leftover = "";

  // Only apply smart-split if the user didn't manually select the text
  if (isAutoExpanded) {
    // Regex matches: 1. Core text, 2. Spaces before parenthesis, 3. The '(' and everything after
    const splitMatch = extractedText.match(/^([\s\S]*?)(\s*)(\([\s\S]*)$/);

    // Make sure we aren't completely eliminating the text (e.g., if line ONLY had "(hint)")
    if (splitMatch && splitMatch[1].trim().length > 0) {
      targetForCloze = splitMatch[1];
      leftover = splitMatch[2] + splitMatch[3]; // Preserves original spacing + parenthesis block
    }
  }
  // ----------------------------------------------

  // Handle prefix/suffix spaces correctly around the target text
  const leadingMatch = targetForCloze.match(/^[\s\u00A0]+/);
  const prefix = leadingMatch ? leadingMatch[0] : "";
  const trailingMatch = targetForCloze.match(/[\s\u00A0]+$/);
  const suffix = trailingMatch ? trailingMatch[0] : "";
  const cleanText = targetForCloze.trim();

  window.PowerSuite.aiToken = "[[AI_TRANSLATING_" + Date.now() + "]]";

  // Notice we now append 'leftover' completely OUTSIDE the cloze tag
  const skeleton = `${prefix}{{c1::${cleanText}::${window.PowerSuite.aiToken}}}${suffix}${leftover}`;

  document.execCommand("removeFormat", false, null);
  document.execCommand("insertText", false, skeleton);

  window.PowerSuite.log("AI Placeholder injected.", "info");

  // We return cleanText so Python sends ONLY the sentence to Gemini/ElevenLabs!
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
// ==========================================
// 3. TTS PIPELINE (F9 / Combo)
// ==========================================
window.PowerSuite.ttsGetText = function () {
  if (window.PowerSuite.isProcessing) {
    window.PowerSuite.log("System is busy. Ignoring TTS request.", "warn");
    return "";
  }

  const activeEl = window.PowerSuite.getEditableRoot();
  if (!activeEl) return "";

  window.PowerSuite.isProcessing = true; // LOCK
  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();

  if (!sel || !sel.rangeCount) {
    window.PowerSuite.isProcessing = false;
    return "";
  }

  let extractedText = sel.toString();
  if (!extractedText.trim()) {
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
      extractedText = blockElement.innerText || blockElement.textContent || "";
    }
  }

  if (!extractedText.trim()) {
    window.PowerSuite.isProcessing = false;
    return "";
  }

  // Strip parentheses and their contents
  let filteredText = extractedText.replace(/\([^)]*\)/g, " ");
  filteredText = filteredText.replace(/\s{2,}/g, " ").trim();

  if (!filteredText) {
    window.PowerSuite.isProcessing = false;
    return "";
  }

  window.PowerSuite.log("TTS Text extracted successfully.", "info");
  return filteredText;
};

window.PowerSuite.ttsInjectAudio = function (filename, targetIndex) {
  function getAllEditableFields(root) {
    const results = [];
    const directHits = root.querySelectorAll(
      '[contenteditable="true"], .field',
    );
    directHits.forEach((el) => {
      if (!results.includes(el)) results.push(el);
    });

    const allElements = root.querySelectorAll("*");
    allElements.forEach((el) => {
      if (el.shadowRoot) {
        const shadowHits = getAllEditableFields(el.shadowRoot);
        shadowHits.forEach((hit) => {
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
    window.PowerSuite.log(`Target field [${targetIndex}] not found.`, "error");
    window.PowerSuite.isProcessing = false; // Unlock
    return;
  }

  const targetField = editables[targetIndex];
  let currentHtml = targetField.innerHTML || "";
  currentHtml = currentHtml.replace(/(<br\s*\/?>|\s)+$/gi, "");

  targetField.innerHTML = currentHtml + `[sound:${filename}]`;

  targetField.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  targetField.dispatchEvent(
    new Event("change", { bubbles: true, composed: true }),
  );

  window.PowerSuite.log(
    `Injected [sound:${filename}] into field index ${targetIndex}.`,
    "success",
  );
  window.PowerSuite.isProcessing = false; // UNLOCK!
};
// ==========================================
// 4. CLOZE UNWRAPPER (Alt+Shift+U)
// ==========================================
window.PowerSuite.unwrapCloze = function () {
  if (window.PowerSuite.isProcessing) return;

  const activeEl = window.PowerSuite.getEditableRoot();
  if (!activeEl) return;

  const rootNode = activeEl.getRootNode();
  const sel = rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();
  if (!sel || !sel.rangeCount) return;

  // 1. Find the current block
  let anchor = sel.anchorNode;
  if (!anchor) return;

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

  const originalHtml = blockElement.innerHTML;

  // Regex matches: {{c(numbers)::(Target Text)::(Hint Text)}} and captures ONLY (Target Text)
  // It also safely handles cases where there is no hint text.
  const unwrapRegex = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g;

  if (!unwrapRegex.test(originalHtml)) {
    window.PowerSuite.log("No cloze deletions found on this line.", "warn");
    return;
  }

  // Strip the cloze formatting
  blockElement.innerHTML = originalHtml.replace(unwrapRegex, "$1");
  blockElement.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );

  // 2. Cleanup Audio Tag (Looks for the last [sound:eleven_...] tag in the whole editor and removes it)
  function getAllEditableFields(root) {
    const results = [];
    root
      .querySelectorAll('[contenteditable="true"], .field')
      .forEach((el) => results.push(el));
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot)
        getAllEditableFields(el.shadowRoot).forEach((hit) => results.push(hit));
    });
    return results;
  }

  const editables = getAllEditableFields(document).filter(
    (el) =>
      el.getAttribute("contenteditable") === "true" ||
      el.classList.contains("editable"),
  );

  // We check all fields from bottom to top (usually audio is in field 2 or 3)
  for (let i = editables.length - 1; i >= 0; i--) {
    let fieldHtml = editables[i].innerHTML;
    // Matches the most recently added ElevenLabs sound tag
    const audioRegex = /\[sound:eleven_[a-f0-9]+\.mp3\](?=[^\[]*$)/;
    if (audioRegex.test(fieldHtml)) {
      editables[i].innerHTML = fieldHtml.replace(audioRegex, "");
      editables[i].dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true }),
      );
      window.PowerSuite.log("Removed orphaned audio tag.", "info");
      break; // Only remove one tag per unwrap!
    }
  }

  window.PowerSuite.log("Cloze unwrapped successfully.", "success");
};
