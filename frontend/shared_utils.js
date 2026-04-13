window.PowerSuite = window.PowerSuite || {
  isProcessing: false,

  // Professional Centralized Logging
  log: function (message, level = "info") {
    const prefix = "%c[PowerSuite]";
    let css = "font-weight: bold; ";

    switch (level) {
      case "success":
        css += "color: #00ff00;";
        break;
      case "error":
        css += "color: #ff0000;";
        break;
      case "warn":
        css += "color: #ffa500;";
        break;
      default:
        css += "color: #00ffff;";
        break; // info
    }
    console.log(`${prefix} ${message}`, css);
  },

  // Finds Anki's hidden editor
  getEditableRoot: function () {
    return (function walk(root) {
      const active = root.activeElement;
      if (!active) return null;
      if (active.contentEditable === "true") return active;
      return active.shadowRoot ? walk(active.shadowRoot) : null;
    })(document);
  },

  // Passively guarantees .del styles survive Add window resets and cross-device syncs
  enforceDelStyles: function () {
    if (window.PowerSuite._delStylesActive) return;
    window.PowerSuite._delStylesActive = true;

    const upgradeSpans = () => {
      const activeRoot = window.PowerSuite.getEditableRoot();
      // Fallback to the main document if the specific editor field isn't focused
      const targetNode = activeRoot ? activeRoot.getRootNode() : document;

      targetNode.querySelectorAll("span.del").forEach((node) => {
        // Unconditionally overwrite all styles to guarantee an exact visual match.
        // Anki's clipboard parser often strips 'opacity' and complex RGBA colors
        // while preserving other properties, so we must re-burn them all every time.
        node.style.textDecorationLine = "line-through";
        node.style.textDecorationColor = "rgba(106, 115, 125, 0.5)";
        node.style.textDecorationThickness = "2.5px";
        node.style.textDecorationSkipInk = "none";
        node.style.color = "#6A737D";
        node.style.fontStyle = "italic";
        node.style.opacity = "0.85";
      });
    };

    // Fire 50ms after a paste (allows Anki to safely handle images/clipboards first)
    document.addEventListener(
      "paste",
      () => setTimeout(upgradeSpans, 50),
      true,
    );

    // Fire on keyup (catches scenarios where you type HTML manually and click back to the visual editor)
    document.addEventListener(
      "keyup",
      () => setTimeout(upgradeSpans, 50),
      true,
    );
  },
};

// Initialize the style enforcer immediately when the editor loads
window.PowerSuite.enforceDelStyles();

// --- Processing Lock Overlay ---
// Replaces mw.progress to avoid Qt focus stealing and popup flicker.
// A transparent overlay blocks all mouse/keyboard interaction in the editor webview.
window.PowerSuite.showLock = function (message, lockType) {
  window.PowerSuite.hideLock();
  window.PowerSuite._lockType = lockType || "unknown";

  const overlay = document.createElement("div");
  overlay.id = "ps-lock-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:transparent;";
  overlay.addEventListener(
    "mousedown",
    function (e) {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  const pill = document.createElement("div");
  pill.id = "ps-lock-label";
  pill.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);" +
    "background:rgba(30,30,30,0.9);color:#ccc;padding:6px 18px;border-radius:20px;" +
    "font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;z-index:100000;" +
    "pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
  pill.textContent = message;

  document.body.appendChild(overlay);
  document.body.appendChild(pill);

  window.PowerSuite._lockKeyHandler = function (e) {
    if (e.key === "Escape") {
      var lt = window.PowerSuite._lockType;
      if (lt === "ai" || lt === "combo") {
        window.PowerSuite.unwrapCloze();
      } else {
        window.PowerSuite.isProcessing = false;
      }
      window.PowerSuite.hideLock();
      pycmd("ps__abort");
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  document.addEventListener("keydown", window.PowerSuite._lockKeyHandler, true);
};

window.PowerSuite.updateLock = function (message) {
  var label = document.getElementById("ps-lock-label");
  if (label) label.textContent = message;
};

window.PowerSuite.hideLock = function () {
  var overlay = document.getElementById("ps-lock-overlay");
  var label = document.getElementById("ps-lock-label");
  if (overlay) overlay.remove();
  if (label) label.remove();
  if (window.PowerSuite._lockKeyHandler) {
    document.removeEventListener(
      "keydown",
      window.PowerSuite._lockKeyHandler,
      true,
    );
    window.PowerSuite._lockKeyHandler = null;
  }
  window.PowerSuite._lockType = null;
};
