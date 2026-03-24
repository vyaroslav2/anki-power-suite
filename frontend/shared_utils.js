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
};
