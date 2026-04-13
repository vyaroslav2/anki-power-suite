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
          // --- Smart Parenthesis Formatting ---
          let targetHtml = html;
          let leftoverHtml = "";
          let searchIndex = 0;

          while (true) {
            const tempHtml = html.slice(searchIndex);
            // Non-greedy search up to the first parenthesis, including preceding spaces
            const splitMatch = tempHtml.match(
              /^([\s\S]*?)((?:\s|&nbsp;|\u00A0)*\([\s\S]*)$/i,
            );

            if (!splitMatch) break;

            const preHtml = html.slice(0, searchIndex) + splitMatch[1];

            // Safety Check: Ensure we aren't splitting inside an HTML attribute
            const openTags = (preHtml.match(/</g) || []).length;
            const closeTags = (preHtml.match(/>/g) || []).length;

            if (openTags === closeTags) {
              const preText = preHtml.replace(/<[^>]+>/g, "").trim();
              // Only split if there's actual sentence content before the parenthesis
              if (preText.length > 0) {
                targetHtml = preHtml;
                leftoverHtml = splitMatch[2];
                break; // Found the perfect split point
              }
            }

            // Advance the index and keep searching
            const parenOffset = splitMatch[2].indexOf("(");
            searchIndex += splitMatch[1].length + parenOffset + 1;
          }

          line.innerHTML = `${indent}<i>${targetHtml}</i>${leftoverHtml}`;
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

  window.PowerSuite.isProcessing = true;
  window.PowerSuite.aiActiveElement = activeEl;

  // Extract raw HTML to protect spans like <span class="del">
  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();
  const div = document.createElement("div");
  div.appendChild(frag);
  const selectedHTML = div.innerHTML;

  let targetHTML = selectedHTML;
  let leftoverHTML = "";

  // Split HTML at the first parenthesis not enclosed in HTML tags
  if (isAutoExpanded) {
    let inTag = false;
    let splitIndex = -1;
    for (let i = 0; i < selectedHTML.length; i++) {
      if (selectedHTML[i] === "<") inTag = true;
      else if (selectedHTML[i] === ">") inTag = false;
      else if (!inTag && selectedHTML[i] === "(") {
        splitIndex = i;
        break;
      }
    }

    if (splitIndex !== -1) {
      targetHTML = selectedHTML.slice(0, splitIndex);
      leftoverHTML = selectedHTML.slice(splitIndex);
    }
  }

  // --- NEW LOGIC: DOM-Walker to safely pull whitespace out from inside formatting tags ---
  const divForTrim = document.createElement("div");
  divForTrim.innerHTML = targetHTML;

  function extractLeadingWhitespace(el) {
    let ws = "";
    while (el.firstChild) {
      let node = el.firstChild;
      if (node.nodeType === 3) {
        // Text Node
        let match = node.nodeValue.match(/^([\s\u00A0]+)/);
        if (match) {
          ws += match[1].replace(/\u00A0/g, "&nbsp;");
          node.nodeValue = node.nodeValue.slice(match[1].length);
          if (node.nodeValue.length === 0) el.removeChild(node);
          else break;
        } else break;
      } else if (node.nodeName === "BR") {
        ws += "<br>";
        el.removeChild(node);
      } else if (node.nodeType === 1) {
        // Element Node (e.g., <i>)
        let childWs = extractLeadingWhitespace(node);
        ws += childWs;
        if (node.childNodes.length === 0) el.removeChild(node);
        else break;
      } else break;
    }
    return ws;
  }

  function extractTrailingWhitespace(el) {
    let ws = "";
    while (el.lastChild) {
      let node = el.lastChild;
      if (node.nodeType === 3) {
        let match = node.nodeValue.match(/([\s\u00A0]+)$/);
        if (match) {
          ws = match[1].replace(/\u00A0/g, "&nbsp;") + ws;
          node.nodeValue = node.nodeValue.slice(0, -match[1].length);
          if (node.nodeValue.length === 0) el.removeChild(node);
          else break;
        } else break;
      } else if (node.nodeName === "BR") {
        ws = "<br>" + ws;
        el.removeChild(node);
      } else if (node.nodeType === 1) {
        let childWs = extractTrailingWhitespace(node);
        ws = childWs + ws;
        if (node.childNodes.length === 0) el.removeChild(node);
        else break;
      } else break;
    }
    return ws;
  }

  const prefix = extractLeadingWhitespace(divForTrim);
  const suffix = extractTrailingWhitespace(divForTrim);
  const innerHTML = divForTrim.innerHTML;

  // Clean text strictly for Gemini's prompt (strips all HTML)
  const divForText = document.createElement("div");
  divForText.innerHTML = innerHTML;
  // Remove .pill elements so grammar-note badges don't pollute the AI prompt
  divForText.querySelectorAll(".pill").forEach((el) => el.remove());
  const cleanTextForAI = divForText.textContent || divForText.innerText || "";

  window.PowerSuite.aiToken = "[[AI_TRANSLATING_" + Date.now() + "]]";

  // Build the skeleton, sandwiching the clean HTML between the extracted spacing
  const skeletonHTML = `${prefix}{{c1::${innerHTML}::${window.PowerSuite.aiToken}}}${suffix}${leftoverHTML}`;

  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("insertHTML", false, skeletonHTML);

  activeEl.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );

  window.PowerSuite.log("AI Placeholder injected.", "info");
  return cleanTextForAI.trim();
};

window.PowerSuite.aiInjectCloze = function (translated, isCombo) {
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
    let lineBlock =
      targetNode.nodeType === 3 ? targetNode.parentNode : targetNode;
    while (
      lineBlock &&
      lineBlock !== activeEl &&
      !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
        lineBlock.nodeName.toUpperCase(),
      )
    ) {
      lineBlock = lineBlock.parentNode;
    }

    if (isCombo) {
      window.PowerSuite.comboActiveLine = lineBlock || activeEl;
    }

    const range = document.createRange();
    const startIdx = targetNode.nodeValue.indexOf(token);
    range.setStart(targetNode, startIdx);
    range.setEnd(targetNode, startIdx + token.length);
    sel.removeAllRanges();
    sel.addRange(range);

    // insertText is perfectly safe here! It strictly targets the characters of the token inside
    // a pure Text Node, so it is impossible for it to affect leftoverHTML or .del spans.
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

  if (!isCombo) window.PowerSuite.isProcessing = false;
  return true;
};

// ==========================================
// HELPER: Reconstruct plain sentence from cloze line
// ==========================================
window.PowerSuite.reconstructCloze = function (text) {
  // 0. Strip .pill spans via DOM so grammar-note badges don't reach TTS
  const tmpDiv = document.createElement("div");
  tmpDiv.innerHTML = text;
  tmpDiv.querySelectorAll(".pill").forEach((el) => el.remove());
  text = tmpDiv.innerHTML;

  // 1. Strip everything in parentheses (grammar annotations)
  let reconstructed = text.replace(/\([^)]*\)/g, " ");

  // 2. Extract front side of clozes (Non-greedy matching for Anki syntax)
  // {{c1::answer::hint}} -> answer
  // {{c1::answer}} -> answer
  reconstructed = reconstructed.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1");

  // 3. Strip any remaining HTML tags left after DOM surgery
  reconstructed = reconstructed.replace(/<[^>]+>/g, " ");

  // 4. Normalize spaces
  return reconstructed.replace(/\s{2,}/g, " ").trim();
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

  let extractedText = "";
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

  // Clone content and strip .pill spans so grammar badges never reach the TTS API
  const raw = sel.toString();
  if (!raw.trim()) {
    isAutoExpanded = true;
    const clone = blockElement.cloneNode(true);
    clone.querySelectorAll(".pill").forEach((el) => el.remove());
    extractedText = clone.innerText || clone.textContent || "";
  } else {
    // Manual selection: clone the fragment, strip .pill, then read text
    const frag = sel.getRangeAt(0).cloneContents();
    const wrapper = document.createElement("div");
    wrapper.appendChild(frag);
    wrapper.querySelectorAll(".pill").forEach((el) => el.remove());
    extractedText = wrapper.textContent || "";
  }
  if (!extractedText.trim()) return "";

  // No mapping tracker here. F9 stays anonymous.

  let filteredText = extractedText;
  if (isAutoExpanded) {
    filteredText = filteredText.replace(/\([^)]*\)/g, " ");
    filteredText = filteredText.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1");
    filteredText = filteredText.replace(/\s{2,}/g, " ").trim();
  } else {
    filteredText = filteredText.trim();
  }

  if (!filteredText) return "";

  window.PowerSuite.isProcessing = true;
  window.PowerSuite.log("TTS Text extracted successfully.", "info");
  return filteredText;
};

window.PowerSuite.ttsInjectAudio = function (filenamePayload, targetIndex, trackForUnwrap) {
  if (!window.PowerSuite.isProcessing) return false;

  let filenames = Array.isArray(filenamePayload) ? filenamePayload : [filenamePayload];

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
    window.PowerSuite.comboActiveLine = null;
    return false;
  }

  // 2. SECURE THE MAP: Attach the filename strictly to the line for Unwrap
  if (window.PowerSuite.comboActiveLine && trackForUnwrap !== false) {
    window.PowerSuite.comboActiveLine.setAttribute(
      "data-combo-audio",
      JSON.stringify(filenames)
    );
    window.PowerSuite.comboActiveLine = null; // Clear the tracker immediately
  }

  const targetField = editables[targetIndex];
  let currentHtml = targetField.innerHTML || "";
  currentHtml = currentHtml.replace(/(<br\s*\/?>|\s)+$/gi, "");
  
  let tags = filenames.map(f => `[sound:${f}]`).join(" ");
  targetField.innerHTML = currentHtml + ` ${tags}`;

  targetField.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  targetField.dispatchEvent(
    new Event("change", { bubbles: true, composed: true }),
  );

  window.PowerSuite.log(`Audio injected successfully (${filenames.length} files).`, "success");
  window.PowerSuite.isProcessing = false;
  return true;
};

// ==========================================
// 4. CLOZE UNWRAPPER / ABORT TRIGGER
// ==========================================
window.PowerSuite.unwrapCloze = function () {
  let wasAborting = false;
  let tokenToKill = window.PowerSuite.aiToken;

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
      // 3. READ THE MAP: Extract the Combo audio filename BEFORE replacing HTML
      if (block.hasAttribute("data-combo-audio")) {
        window.PowerSuite.pendingComboKill =
          block.getAttribute("data-combo-audio");
        block.removeAttribute("data-combo-audio");
      }

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
    if (unwrapBlock(blockElement)) actionResult = "UNWRAPPED";
  }

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
        )
          p = p.parentNode;
        if (p && unwrapBlock(p)) actionResult = "UNWRAPPED";
        break;
      }
    }
  }

  // 4. PRECISION KILL: Destroy ONLY the specific Combo audio
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

    let fileToKillPayload = window.PowerSuite.pendingComboKill;
    window.PowerSuite.pendingComboKill = null; // Clear queue

    if (fileToKillPayload) {
      let filesToKill = [];
      try {
        filesToKill = JSON.parse(fileToKillPayload);
      } catch(e) {
        filesToKill = [fileToKillPayload]; // Fallback for old single string
      }
      
      for (let fileToKill of filesToKill) {
        // Regex explicitly targets the mapped filename
        const specificAudioRegex = new RegExp(`\\[sound:${fileToKill}\\]`, "g");
        for (let i = editables.length - 1; i >= 0; i--) {
          if (specificAudioRegex.test(editables[i].innerHTML)) {
            editables[i].innerHTML = editables[i].innerHTML.replace(
              specificAudioRegex,
              "",
            );
            editables[i].dispatchEvent(
              new InputEvent("input", { bubbles: true, composed: true }),
            );
            window.PowerSuite.log(`Removed Combo audio: ${fileToKill}`, "info");
            actionResult = "UNWRAPPED_WITH_AUDIO";
          }
        }
      }
    }
    // F9 audio is now completely safe because the fallback regex was removed!
  }

  if (wasAborting) return "ABORTED";
  if (actionResult.startsWith("UNWRAPPED"))
    window.PowerSuite.log("Cloze unwrapped successfully.", "success");
  return actionResult;
};
