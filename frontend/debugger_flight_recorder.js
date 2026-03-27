// frontend/debugger_flight_recorder.js

window.PowerSuiteDebug = window.PowerSuiteDebug || {
  initialized: false,
  snapshotTimeout: null,

  send: function (payload) {
    payload.js_time = new Date().toISOString();
    if (window.pycmd) {
      window.pycmd("powersuite-debug:" + JSON.stringify(payload));
    } else {
      console.log("Debug payload (No pycmd):", payload);
    }
  },

  getCursorState: function () {
    const root =
      window.PowerSuite && window.PowerSuite.getEditableRoot
        ? window.PowerSuite.getEditableRoot()
        : null;
    if (!root) return { status: "No editable root" };

    const rootNode = root.getRootNode();
    const sel = rootNode.getSelection
      ? rootNode.getSelection()
      : window.getSelection();

    if (!sel || sel.rangeCount === 0) return { status: "No selection" };

    let block = sel.anchorNode;
    while (
      block &&
      block !== root &&
      !["DIV", "P", "LI", "ANKI-EDITABLE"].includes(
        block.nodeName?.toUpperCase(),
      )
    ) {
      block = block.parentNode;
    }

    return {
      collapsed: sel.isCollapsed,
      anchorNodeName: sel.anchorNode ? sel.anchorNode.nodeName : null,
      anchorNodeType: sel.anchorNode ? sel.anchorNode.nodeType : null,
      anchorOffset: sel.anchorOffset,
      focusOffset: sel.focusOffset,
      selectedText: sel.toString(),
      activeBlockHtml: block ? block.outerHTML : null,
    };
  },

  takeDomSnapshot: function (triggerReason) {
    const root =
      window.PowerSuite && window.PowerSuite.getEditableRoot
        ? window.PowerSuite.getEditableRoot()
        : null;
    if (!root) return;

    this.send({
      type: "dom_snapshot",
      reason: triggerReason,
      cursor: this.getCursorState(),
      full_html: root.innerHTML,
    });
  },

  scheduleSnapshot: function () {
    clearTimeout(this.snapshotTimeout);
    this.snapshotTimeout = setTimeout(() => {
      this.takeDomSnapshot("debounced_typing_pause");
    }, 250);
  },

  init: function () {
    if (this.initialized) return;
    this.initialized = true;

    this.send({
      type: "js_init",
      message: "Flight Recorder Attached & Locked",
    });

    // 1. KEYBOARD
    document.addEventListener(
      "keydown",
      (e) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        this.send({
          type: "keydown",
          key: e.key,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          cursor_before: this.getCursorState(),
        });
        this.scheduleSnapshot();
      },
      true,
    );

    // 2. MOUSE
    document.addEventListener(
      "mouseup",
      (e) => {
        setTimeout(() => {
          this.send({
            type: "cursor_move",
            method: "mouse_click",
            cursor: this.getCursorState(),
          });
        }, 10);
      },
      true,
    );

    // 3. EXEC-COMMAND INTERCEPTOR
    const originalExec = document.execCommand;
    document.execCommand = function (commandId, showUI, value) {
      window.PowerSuiteDebug.send({
        type: "exec_command",
        command: commandId,
        value: value,
        cursor_before: window.PowerSuiteDebug.getCursorState(),
      });
      const result = originalExec.apply(document, arguments);
      window.PowerSuiteDebug.scheduleSnapshot();
      return result;
    };

    // 4. INPUT INTERCEPTOR
    document.addEventListener(
      "input",
      (e) => {
        if (
          e.inputType &&
          !["insertText", "deleteContentBackward"].includes(e.inputType)
        ) {
          window.PowerSuiteDebug.send({
            type: "input_event",
            inputType: e.inputType,
            data: e.data,
          });
          window.PowerSuiteDebug.scheduleSnapshot();
        }
      },
      true,
    );
  },

  // 5. HOOK POWERSUITE METHODS
  applyHooks: function () {
    // Safety check to ensure PowerSuite exists before we try to hook into it
    if (!window.PowerSuite) return;

    const hookFn = (fnName) => {
      if (window.PowerSuite[fnName] && !window.PowerSuite[fnName].isHooked) {
        const orig = window.PowerSuite[fnName];
        window.PowerSuite[fnName] = function () {
          window.PowerSuiteDebug.send({
            type: "hotkey_triggered",
            function: fnName,
            cursor_before: window.PowerSuiteDebug.getCursorState(),
          });

          const res = orig.apply(window.PowerSuite, arguments);

          window.PowerSuiteDebug.takeDomSnapshot(`post_hotkey_${fnName}`);
          return res;
        };
        window.PowerSuite[fnName].isHooked = true;
      }
    };

    const methodsToHook = [
      "formatCurrentLine",
      "aiGetText",
      "aiInjectCloze",
      "ttsGetText",
      "ttsInjectAudio",
      "unwrapCloze",
    ];

    methodsToHook.forEach(hookFn);

    // Hook the logger
    if (window.PowerSuite.log && !window.PowerSuite.log.isHooked) {
      const originalLog = window.PowerSuite.log;
      window.PowerSuite.log = function (message, level) {
        window.PowerSuiteDebug.send({
          type: "script_log",
          level: level,
          message: message,
        });
        originalLog.apply(window.PowerSuite, arguments);
      };
      window.PowerSuite.log.isHooked = true;
    }
  },
};

// Fire the setup methods
window.PowerSuiteDebug.init();
window.PowerSuiteDebug.applyHooks();
