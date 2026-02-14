(() => {
  if (window.__TAURI_TESTING_BRIDGE__) {
    return;
  }

  const RESPONSE_EVENT = "plugin:testing://bridge-response";

  const dialogState = {
    events: [],
    maxEvents: 100,
    auto: {
      confirm: true,
      promptText: "",
      tauriAsk: true,
      tauriConfirm: true,
    },
    queue: [],
    windowPatched: false,
    invokePatched: false,
    invokePatchMode: "none",
  };

  const emitResponse = async (payload) => {
    let delivered = false;
    try {
      if (window.__TAURI_INTERNALS__?.invoke) {
        await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event: RESPONSE_EVENT,
          payload,
        });
        delivered = true;
      }
    } catch {
      // ignore emit failures
    }

    try {
      // Fallback path that calls plugin command directly.
      if (window.__TAURI_INTERNALS__?.invoke) {
        await window.__TAURI_INTERNALS__.invoke("plugin:testing|bridge_response", { payload });
        delivered = true;
      }
    } catch {
      // ignore invoke failures
    }

    if (!delivered) {
      // best-effort diagnostics for bridge delivery issues
      console.warn("[tauri-testing-bridge] failed to deliver response payload");
    }
  };

  const ok = async (id, result) => emitResponse({ id, result });
  const fail = async (id, code, message, data) => emitResponse({
    id,
    error: {
      code,
      message,
      data,
    },
  });

  const textValue = (value) => (value ?? "").toString().trim();
  const normalize = (value) => textValue(value).replace(/\s+/g, " ");
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

  const toBridgeError = (message, code = -32000, data) =>
    Object.assign(new Error(message), { code, data });

  const includesText = (haystack, needle, exact) => {
    const h = normalize(haystack);
    const n = normalize(needle);
    if (!n) return false;
    return exact ? h === n : h.includes(n);
  };

  const extractElementText = (el) => {
    if (!el) return "";

    const bits = [
      el.textContent,
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("alt"),
      el.getAttribute?.("placeholder"),
      el.value,
    ];

    const id = el.getAttribute?.("id");
    if (id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (forLabel) bits.push(forLabel.textContent);
    }

    const parentLabel = el.closest?.("label");
    if (parentLabel) bits.push(parentLabel.textContent);

    return bits.map(textValue).filter(Boolean).join(" ");
  };

  const isElementVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (style.opacity === "0") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    return true;
  };

  const isElementDisabled = (el) => {
    if (!el) return true;
    if (typeof el.disabled === "boolean" && el.disabled) return true;

    const ariaDisabled = el.getAttribute?.("aria-disabled");
    if (ariaDisabled === "true") return true;

    return false;
  };

  const queryAllDeep = (selector, root = document) => {
    const results = [];
    const seen = new Set();

    const visitRoot = (searchRoot) => {
      if (!searchRoot || typeof searchRoot.querySelectorAll !== "function") return;

      const found = searchRoot.querySelectorAll(selector);
      for (const item of found) {
        if (!seen.has(item)) {
          seen.add(item);
          results.push(item);
        }
      }

      const hosts = searchRoot.querySelectorAll("*");
      for (const host of hosts) {
        if (host.shadowRoot) {
          visitRoot(host.shadowRoot);
        }
      }
    };

    visitRoot(root);
    return results;
  };

  const queryFirstDeep = (selector, root = document) => {
    const all = queryAllDeep(selector, root);
    return all[0] ?? null;
  };

  const scrollIntoViewIfNeeded = (el) => {
    try {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch {
      try {
        el.scrollIntoView({ block: "center", inline: "center" });
      } catch {
        // ignore
      }
    }
  };

  const dispatchMouseSequence = (el, includeClick = true) => {
    const mouseInit = { bubbles: true, cancelable: true, view: window };

    if (typeof window.PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerdown", mouseInit));
      el.dispatchEvent(new PointerEvent("pointerup", mouseInit));
    }

    el.dispatchEvent(new MouseEvent("mousedown", mouseInit));
    el.dispatchEvent(new MouseEvent("mouseup", mouseInit));
    if (includeClick) {
      el.dispatchEvent(new MouseEvent("click", mouseInit));
    }
  };

  const ensureInteractable = (el, hint = "Element") => {
    if (!el) {
      throw toBridgeError(`${hint} not found`, -32000);
    }
    if (!el.isConnected) {
      throw toBridgeError(`${hint} is detached from DOM`, -32000);
    }
    if (!isElementVisible(el)) {
      throw toBridgeError(`${hint} is not visible`, -32000);
    }
    if (isElementDisabled(el)) {
      throw toBridgeError(`${hint} is disabled`, -32000);
    }
  };

  const clickElement = (el, hint = "Element") => {
    ensureInteractable(el, hint);
    scrollIntoViewIfNeeded(el);

    if (typeof el.focus === "function") {
      el.focus();
    }

    // Keep full mouse down/up semantics, but trigger a single click activation.
    // Previously both synthetic click event and el.click() were fired, causing
    // toggle handlers to run twice.
    dispatchMouseSequence(el, false);
    if (typeof el.click === "function") el.click();
  };

  const setInputValue = (target, value) => {
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement?.prototype ?? {}, "value")?.set;
    const textAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype ?? {}, "value")?.set;

    if (target.tagName === "TEXTAREA") {
      if (textAreaSetter) textAreaSetter.call(target, value);
      else target.value = value;
    } else {
      if (inputSetter) inputSetter.call(target, value);
      else target.value = value;
    }

    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const typeContentEditable = (target, value, clear) => {
    ensureInteractable(target, "contenteditable target");
    scrollIntoViewIfNeeded(target);
    target.focus();

    if (clear) {
      target.innerHTML = "";
    }

    // TipTap compatibility: execCommand still triggers internal observers on WKWebView/Chromium
    document.execCommand("insertText", false, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const waitForCondition = async (predicate, timeoutMs, timeoutMessage) =>
    await new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let timer = null;
      let interval = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        if (observer) observer.disconnect();
      };

      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const check = () => {
        try {
          const value = predicate();
          if (value) {
            done(resolve, value);
          }
        } catch (err) {
          done(reject, err);
        }
      };

      timer = setTimeout(() => {
        done(reject, toBridgeError(timeoutMessage, -32001));
      }, timeoutMs);

      const root = document.documentElement || document.body;
      if (root && typeof MutationObserver === "function") {
        observer = new MutationObserver(check);
        observer.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }

      interval = setInterval(check, 120);
      check();
    });

  const pushDialogEvent = (event) => {
    dialogState.events.push({
      ...event,
      timestamp: Date.now(),
    });

    if (dialogState.events.length > dialogState.maxEvents) {
      dialogState.events.splice(0, dialogState.events.length - dialogState.maxEvents);
    }
  };

  const popQueuedDialogResponse = (kind) => {
    const idx = dialogState.queue.findIndex((item) => !item.kind || item.kind === kind);
    if (idx < 0) return undefined;
    const [entry] = dialogState.queue.splice(idx, 1);
    return entry?.value;
  };

  const patchWindowDialogs = () => {
    if (dialogState.windowPatched) {
      return;
    }

    window.alert = (message) => {
      pushDialogEvent({
        source: "window.alert",
        kind: "alert",
        message: textValue(message),
      });
      return undefined;
    };

    window.confirm = (message) => {
      pushDialogEvent({
        source: "window.confirm",
        kind: "confirm",
        message: textValue(message),
      });

      const queued = popQueuedDialogResponse("confirm");
      if (queued !== undefined) {
        return Boolean(queued);
      }

      return Boolean(dialogState.auto.confirm);
    };

    window.prompt = (message, defaultValue = "") => {
      pushDialogEvent({
        source: "window.prompt",
        kind: "prompt",
        message: textValue(message),
        defaultValue: textValue(defaultValue),
      });

      const queued = popQueuedDialogResponse("prompt");
      if (queued !== undefined) {
        if (queued === null) return null;
        return String(queued);
      }

      if (dialogState.auto.promptText === null) {
        return null;
      }

      return String(dialogState.auto.promptText ?? defaultValue ?? "");
    };

    dialogState.windowPatched = true;
  };

  const normalizeDialogMessage = (args) => {
    if (typeof args === "string") {
      return args;
    }
    if (!args || typeof args !== "object") {
      return "";
    }

    const candidates = [
      args.message,
      args.description,
      args.title,
      args.kind,
    ];

    for (const candidate of candidates) {
      const text = textValue(candidate);
      if (text) return text;
    }

    return textValue(JSON.stringify(args));
  };

  const patchTauriDialogInvokeIfNeeded = () => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return;
    }

    if (internals.invoke.__TAURI_TEST_DIALOG_PATCHED__) {
      dialogState.invokePatched = true;
      dialogState.invokePatchMode = "direct";
      return;
    }

    const originalInvoke = internals.invoke.bind(internals);

    const wrappedInvoke = async (command, args = {}) => {
      if (typeof command === "string" && command.startsWith("plugin:dialog|")) {
        const message = normalizeDialogMessage(args);

        if (command === "plugin:dialog|ask") {
          pushDialogEvent({
            source: "tauri.ask",
            kind: "confirm",
            message,
          });

          const queued = popQueuedDialogResponse("confirm");
          if (queued !== undefined) {
            return Boolean(queued);
          }
          return Boolean(dialogState.auto.tauriAsk);
        }

        if (command === "plugin:dialog|confirm") {
          pushDialogEvent({
            source: "tauri.confirm",
            kind: "confirm",
            message,
          });

          const queued = popQueuedDialogResponse("confirm");
          if (queued !== undefined) {
            return Boolean(queued);
          }
          return Boolean(dialogState.auto.tauriConfirm);
        }

        if (command === "plugin:dialog|message") {
          pushDialogEvent({
            source: "tauri.message",
            kind: "alert",
            message,
          });
          return null;
        }
      }

      return await originalInvoke(command, args);
    };

    wrappedInvoke.__TAURI_TEST_DIALOG_PATCHED__ = true;
    // 1) Direct replace on __TAURI_INTERNALS__.invoke
    let patched = false;
    try {
      internals.invoke = wrappedInvoke;
      patched = internals.invoke === wrappedInvoke
        || Boolean(internals.invoke?.__TAURI_TEST_DIALOG_PATCHED__);
      if (patched) {
        dialogState.invokePatched = true;
        dialogState.invokePatchMode = "direct";
      }
    } catch {
      // fall through to proxy strategy
    }

    // 2) Fallback: replace __TAURI_INTERNALS__ with a proxy that overrides invoke.
    if (!patched) {
      try {
        const proxiedInternals = new Proxy(internals, {
          get(target, prop, receiver) {
            if (prop === "invoke") return wrappedInvoke;
            return Reflect.get(target, prop, receiver);
          },
        });
        window.__TAURI_INTERNALS__ = proxiedInternals;
        patched = window.__TAURI_INTERNALS__?.invoke === wrappedInvoke
          || Boolean(window.__TAURI_INTERNALS__?.invoke?.__TAURI_TEST_DIALOG_PATCHED__);
        if (patched) {
          dialogState.invokePatched = true;
          dialogState.invokePatchMode = "proxy";
        }
      } catch {
        // keep unpatched state
      }
    }
  };

  const ensureRuntimePatches = () => {
    patchWindowDialogs();
    patchTauriDialogInvokeIfNeeded();
  };

  const serializeElement = (node, depth, maxDepth, counters) => {
    if (!node || counters.nodes >= counters.maxNodes || depth > maxDepth) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = textValue(node.textContent);
      return text.length > 0 ? text : null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(tag)) {
      return null;
    }

    counters.nodes += 1;
    const out = { tag };

    if (node.id) out.id = node.id;
    if (node.className && typeof node.className === "string") {
      const className = node.className.trim();
      if (className.length > 0) out.class = className;
    }

    if (node.getAttribute) {
      const role = node.getAttribute("role");
      if (role) out.role = role;
      const ariaLabel = node.getAttribute("aria-label");
      if (ariaLabel) out.ariaLabel = ariaLabel;
      const testId = node.getAttribute("data-testid");
      if (testId) out.testId = testId;
    }

    if (typeof node.type === "string" && node.type.length > 0) out.type = node.type;
    if (typeof node.placeholder === "string" && node.placeholder.length > 0) out.placeholder = node.placeholder;
    if (node.value !== undefined && node.value !== null && node.value !== "") out.value = node.value;

    const children = Array.from(node.childNodes)
      .map((child) => serializeElement(child, depth + 1, maxDepth, counters))
      .filter(Boolean);

    if (children.length > 0) {
      out.children = children;
    } else {
      const text = textValue(node.textContent);
      if (text.length > 0 && text.length < 200) {
        out.text = text;
      }
    }

    return out;
  };

  const methods = {
    "dom.querySelector": async (params) => {
      const selector = params?.selector;
      const index = Number(params?.index ?? 0);
      const matches = queryAllDeep(selector);
      const el = matches[index] ?? null;

      if (!el) {
        throw toBridgeError("Element not found", -32000, { selector, matchCount: matches.length });
      }

      return {
        found: true,
        selector,
        index,
        matchCount: matches.length,
        tagName: el.tagName,
        textContent: textValue(el.textContent),
        visible: isElementVisible(el),
        disabled: isElementDisabled(el),
        checked: typeof el.checked === "boolean" ? el.checked : undefined,
        attributes: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value])),
      };
    },

    "dom.click": async (params) => {
      const selector = params?.selector;
      const index = Number(params?.index ?? 0);
      const matches = queryAllDeep(selector);
      const el = matches[index] ?? null;

      if (!el) {
        throw toBridgeError("Element not found", -32000, { selector, matchCount: matches.length });
      }

      clickElement(el);
      return { clicked: true, selector, index, matchCount: matches.length };
    },

    "dom.fill": async (params) => {
      const selector = params?.selector;
      const value = params?.value ?? "";
      const index = Number(params?.index ?? 0);
      const matches = queryAllDeep(selector);
      const el = matches[index] ?? null;

      if (!el) {
        throw toBridgeError("Element not found", -32000, { selector, matchCount: matches.length });
      }

      scrollIntoViewIfNeeded(el);
      if (typeof el.focus === "function") {
        el.focus();
      }

      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        setInputValue(el, value);
      } else if (el.isContentEditable) {
        typeContentEditable(el, value, true);
      } else {
        throw toBridgeError("Target is not fillable", -32000, { selector, tagName: el.tagName });
      }

      return { filled: true, selector, index };
    },

    "dom.getText": async (params) => {
      const selector = params?.selector;
      const index = Number(params?.index ?? 0);
      const matches = queryAllDeep(selector);
      const el = matches[index] ?? null;

      if (!el) {
        throw toBridgeError("Element not found", -32000, { selector, matchCount: matches.length });
      }

      return { text: textValue(el.textContent), selector, index };
    },

    "dom.clickByText": async (params) => {
      const text = params?.text ?? "";
      const exact = Boolean(params?.exact);
      const visibleOnly = hasOwn(params, "visibleOnly") ? Boolean(params?.visibleOnly) : true;
      const selector = params?.selector
        ?? "button, [role='button'], [role='option'], a, label, summary, [data-testid], [aria-label], [title]";
      const elements = queryAllDeep(selector);

      const matches = elements.filter((el) => includesText(extractElementText(el), text, exact));
      const match = (visibleOnly ? matches.find((el) => isElementVisible(el)) : null) ?? matches[0] ?? null;

      if (!match) {
        throw toBridgeError("Element not found by text", -32000, {
          text,
          selector,
          exact,
          candidateCount: elements.length,
        });
      }

      clickElement(match, "Element");
      return {
        clicked: true,
        selector,
        text,
        matchedText: textValue(extractElementText(match)),
        tagName: match.tagName,
      };
    },

    "dom.fillByPlaceholder": async (params) => {
      const placeholder = params?.placeholder ?? "";
      const value = params?.value ?? "";
      const exact = Boolean(params?.exact);
      const fields = queryAllDeep("input[placeholder], textarea[placeholder]");
      const target = fields.find((el) => {
        const attr = el.getAttribute("placeholder");
        return includesText(attr, placeholder, exact);
      });

      if (!target) {
        throw toBridgeError("Input not found by placeholder", -32000, { placeholder, exact });
      }

      ensureInteractable(target, "Input");
      scrollIntoViewIfNeeded(target);
      target.focus();
      setInputValue(target, value);

      return {
        filled: true,
        placeholder: target.getAttribute("placeholder"),
      };
    },

    "dom.typeContentEditable": async (params) => {
      const value = params?.value ?? "";
      const index = Number(params?.index ?? 0);
      const clear = Boolean(params?.clear ?? false);
      const editables = queryAllDeep("[contenteditable='true']");
      const target = editables[index] ?? null;

      if (!target) {
        throw toBridgeError("contenteditable target not found", -32000, { index, candidateCount: editables.length });
      }

      typeContentEditable(target, value, clear);
      return { typed: true, index };
    },

    "dom.typeContentEditableBySelector": async (params) => {
      const selector = params?.selector;
      const value = params?.value ?? "";
      const index = Number(params?.index ?? 0);
      const clear = Boolean(params?.clear ?? false);
      const matches = queryAllDeep(selector);
      const target = matches[index] ?? null;

      if (!target) {
        throw toBridgeError("contenteditable target not found", -32000, { selector, index, candidateCount: matches.length });
      }
      if (!target.isContentEditable) {
        throw toBridgeError("target is not contenteditable", -32000, { selector, index, tagName: target.tagName });
      }

      typeContentEditable(target, value, clear);
      return { typed: true, selector, index, matchCount: matches.length };
    },

    "dom.waitForText": async (params) => {
      const text = params?.text ?? "";
      const timeoutMs = Number(params?.timeout ?? 10000);
      const exact = Boolean(params?.exact);
      const selector = params?.selector ?? "body";

      const result = await waitForCondition(
        () => {
          const nodes = queryAllDeep(selector);
          const foundNode = nodes.find((node) => includesText(extractElementText(node), text, exact));
          if (!foundNode) return null;
          return {
            found: true,
            text,
            selector,
            matchedText: textValue(extractElementText(foundNode)),
          };
        },
        timeoutMs,
        "Timeout waiting for text",
      );

      return result;
    },

    "dom.waitForSelector": async (params) => {
      const selector = params?.selector;
      const timeoutMs = Number(params?.timeout ?? 5000);
      const visible = Boolean(params?.visible ?? false);

      const result = await waitForCondition(
        () => {
          const el = queryFirstDeep(selector);
          if (!el) return null;
          if (visible && !isElementVisible(el)) return null;

          return {
            found: true,
            selector,
            tagName: el.tagName,
            visible: isElementVisible(el),
          };
        },
        timeoutMs,
        "Timeout waiting for selector",
      );

      return result;
    },

    "dom.getPageContent": async (params) => {
      const maxDepth = Number(params?.maxDepth ?? 5);
      const maxNodes = Number(params?.maxNodes ?? 500);
      const selector = params?.selector;
      const root = selector ? queryFirstDeep(selector) : document.body;

      if (!root) {
        throw toBridgeError("Root element not found", -32000, { selector });
      }

      const counters = { nodes: 0, maxNodes };
      const tree = serializeElement(root, 0, maxDepth, counters);

      return {
        title: document.title,
        url: window.location.href,
        tree,
        nodeCount: counters.nodes,
      };
    },

    "dialog.getState": async () => {
      return {
        events: [...dialogState.events],
        auto: { ...dialogState.auto },
        queuedResponses: dialogState.queue.length,
        invokePatched: dialogState.invokePatched,
        invokePatchMode: dialogState.invokePatchMode,
      };
    },

    "dialog.setAutoResponse": async (params) => {
      if (hasOwn(params, "confirm")) {
        dialogState.auto.confirm = Boolean(params.confirm);
      }
      if (hasOwn(params, "promptText")) {
        dialogState.auto.promptText = params.promptText;
      }
      if (hasOwn(params, "tauriAsk")) {
        dialogState.auto.tauriAsk = Boolean(params.tauriAsk);
      }
      if (hasOwn(params, "tauriConfirm")) {
        dialogState.auto.tauriConfirm = Boolean(params.tauriConfirm);
      }
      if (Boolean(params?.clearHistory)) {
        dialogState.events = [];
      }

      return {
        updated: true,
        auto: { ...dialogState.auto },
        eventCount: dialogState.events.length,
      };
    },

    "dialog.pushResponse": async (params) => {
      const kind = params?.kind;
      const value = hasOwn(params, "value") ? params.value : true;
      dialogState.queue.push({ kind, value });

      return {
        queued: true,
        queueLength: dialogState.queue.length,
      };
    },

    "dialog.clear": async (params) => {
      dialogState.events = [];
      if (!hasOwn(params, "keepQueue") || !params.keepQueue) {
        dialogState.queue = [];
      }

      return {
        cleared: true,
        queueLength: dialogState.queue.length,
      };
    },

    "tauri.invoke": async (params) => {
      if (!window.__TAURI_INTERNALS__?.invoke) {
        throw toBridgeError("Tauri internals invoke is not available", -32002);
      }

      const command = params?.command;
      const args = params?.args ?? {};
      const result = await window.__TAURI_INTERNALS__.invoke(command, args);
      return { result };
    },

    "tauri.emit": async (params) => {
      if (!window.__TAURI_INTERNALS__?.invoke) {
        throw toBridgeError("Tauri internals invoke is not available", -32002);
      }
      const event = params?.event;
      const payload = params?.payload;
      await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event, payload });
      return { emitted: true };
    },
  };

  ensureRuntimePatches();

  window.__TAURI_TESTING_BRIDGE__ = {
    async handleRequest(id, method, params = {}) {
      ensureRuntimePatches();

      const impl = methods[method];
      if (!impl) {
        fail(id, -32601, `Method not found: ${method}`);
        return;
      }

      try {
        const result = await impl(params);
        await ok(id, result ?? null);
      } catch (err) {
        const code = Number(err?.code ?? -32603);
        const message = err?.message ?? String(err);
        const data = err?.data;
        await fail(id, code, message, data);
      }
    },
  };
})();
