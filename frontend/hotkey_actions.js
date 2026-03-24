window.PowerSuite.formatCurrentLine = function () {
  // 1. Check the Traffic Cop
  if (window.PowerSuite.isProcessing) {
    console.log(
      "%c[PowerSuite] System is busy. Ignoring format request.",
      "color: red; font-weight: bold;",
    );
    return;
  }

  const editableRoot = window.PowerSuite.getEditableRoot();
  if (!editableRoot) return;

  // 2. Lock the system so other add-ons don't interrupt
  window.PowerSuite.isProcessing = true;

  try {
    const indent = "\u00A0\u00A0\u00A0\u00A0";
    const indentRegex = /^(?:<span[^>]*><\/span>)*(?:\s|&nbsp;|\u00A0){4}/i;

    console.log("%c[1] INITIAL HTML:", "color: orange; font-weight: bold;");
    console.log(editableRoot.innerHTML);

    const rootNode = editableRoot.getRootNode();
    const sel = rootNode.getSelection
      ? rootNode.getSelection()
      : window.getSelection();
    if (!sel || !sel.rangeCount) return;

    // --- STEP 1: DROP SELECTION MARKERS ---
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

    // --- STEP 2: STABLE NORMALIZATION ---
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
          if (currentDiv.childNodes.length === 0) {
            currentDiv.innerHTML = "<br>";
          }
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

    console.log("%c[2] POST-NORMALIZATION:", "color: cyan; font-weight: bold;");
    console.log(editableRoot.innerHTML);

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
      console.log("[DEBUG] Cloze deletion detected. Aborting format.");
      return;
    }

    const refLine =
      scope.find((l) => l.innerText.trim().length > 0) || scope[0];
    const hasIndent = indentRegex.test(refLine.innerHTML);
    const hasItalics = refLine.querySelector("i") !== null;
    const shouldUnformat =
      (hasIndent && hasItalics) || refLine.dataset.ankiFmt === "1";

    console.log(
      `[DEBUG] Toggle state -> hasIndent: ${hasIndent}, hasItalics: ${hasItalics}, shouldUnformat: ${shouldUnformat}`,
    );

    scope.forEach((line, index) => {
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

    // Restore Selection
    const finalStart = editableRoot.querySelector(".anki-fmt-start");
    const finalEnd = editableRoot.querySelector(".anki-fmt-end");
    if (finalStart && finalEnd) {
      const finalRange = document.createRange();
      finalRange.setStartAfter(finalStart);
      finalRange.setEndBefore(finalEnd);
      sel.removeAllRanges();
      sel.addRange(finalRange);
    }

    console.log("%c[3] FINAL RESULT:", "color: lime; font-weight: bold;");
    console.log(editableRoot.innerHTML);
  } catch (e) {
    console.error("FORMATTER ERROR:", e);
  } finally {
    // 3. Cleanup Markers AND Unlock the system
    editableRoot
      .querySelectorAll(".anki-fmt-start, .anki-fmt-end")
      .forEach((m) => m.remove());
    editableRoot.focus();
    window.PowerSuite.isProcessing = false;
  }
};
