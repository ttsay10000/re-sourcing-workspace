const endpointInput = document.getElementById("endpoint");
const tokenInput = document.getElementById("token");
const sendButton = document.getElementById("send");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(["endpoint", "token"]);
  if (settings.endpoint) endpointInput.value = settings.endpoint;
  if (settings.token) tokenInput.value = settings.token;
}

async function saveSettings() {
  await chrome.storage.local.set({
    endpoint: endpointInput.value.trim(),
    token: tokenInput.value.trim(),
  });
}

function collectLoopNetPayload() {
  if (!/loopnet\.com$/i.test(location.hostname) && !/\.loopnet\.com$/i.test(location.hostname)) {
    throw new Error("Open a LoopNet listing tab first.");
  }
  const meta = {};
  document.querySelectorAll("meta[name],meta[property]").forEach((node) => {
    const key = node.getAttribute("property") || node.getAttribute("name");
    const value = node.getAttribute("content");
    if (key && value) meta[key] = value;
  });
  return {
    source: "loopnet",
    captureMode: "browser_extension",
    url: location.href,
    html: document.documentElement.outerHTML,
    metadata: {
      documentTitle: document.title,
      visibleText: (document.body?.innerText || "").slice(0, 60000),
      images: Array.from(document.images)
        .slice(0, 100)
        .map((img) => img.currentSrc || img.src)
        .filter(Boolean),
      links: Array.from(document.links).slice(0, 200).map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.textContent || "").trim().slice(0, 250),
      })),
      meta,
      userAgent: navigator.userAgent,
    },
  };
}

sendButton.addEventListener("click", async () => {
  const endpoint = endpointInput.value.trim();
  const token = tokenInput.value.trim();
  if (!endpoint || !token) {
    setStatus("Endpoint and token are required.");
    return;
  }
  sendButton.disabled = true;
  setStatus("Capturing active tab...");
  try {
    await saveSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");
    const [{ result: payload }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectLoopNetPayload,
    });
    setStatus("Sending to local app...");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LoopNet-Capture-Token": token,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || "Capture failed.");
    setStatus(`Captured run ${data.runId}.`);
  } catch (error) {
    console.error("[LoopNet capture]", error);
    setStatus(`Failed: ${error?.message || error}`);
  } finally {
    sendButton.disabled = false;
  }
});

void loadSettings();
