(() => {
  if (window.__ODDEYES_RUNTIME_BRIDGE__) {
    return;
  }

  const RESPONSE_EVENT = "plugin:oddeyes-bridge://response";

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
      if (window.__TAURI_INTERNALS__?.invoke) {
        await window.__TAURI_INTERNALS__.invoke("plugin:oddeyes-bridge|bridge_response", { payload });
        delivered = true;
      }
    } catch {
      // ignore invoke failures
    }

    if (!delivered) {
      console.warn("[oddeyes-bridge] failed to deliver response payload");
    }
  };

  const ok = async (id, result) => emitResponse({ id, result });
  const fail = async (id, code, message, data) => emitResponse({
    id,
    error: { code, message, data },
  });

  window.__ODDEYES_RUNTIME_BRIDGE__ = {
    async handleRequest(id, method, params = {}) {
      const bridge = window.__ODDEYES_APP_BRIDGE__;
      if (!bridge || typeof bridge.handleRequest !== "function") {
        await fail(id, -32002, "OddEyes app bridge is not initialized");
        return;
      }

      try {
        const result = await bridge.handleRequest(method, params);
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
