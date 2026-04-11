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
