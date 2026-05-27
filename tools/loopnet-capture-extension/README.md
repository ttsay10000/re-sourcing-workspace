# LoopNet Capture Extension

Focused v1 Chrome extension for sending a LoopNet listing page that you can already view in your normal browser to the local RE Sourcing API.

## Install

1. Start the API locally, usually at `http://localhost:4000`.
2. Open the web app Runs / Sourcing Agent page and select LoopNet.
3. Copy the **Extension capture token** shown in the LoopNet browser capture panel, or use the token returned by `/api/test-agent/loopnet/browser-capture-config` while signed into the app.
4. Open Chrome to `chrome://extensions`.
5. Enable Developer mode.
6. Click **Load unpacked** and choose this folder: `tools/loopnet-capture-extension`.
7. Open a LoopNet listing page, click the extension, paste the token, and click **Send to Sourcing App**.

If `LOOPNET_BROWSER_CAPTURE_TOKEN` is not set, the API generates a new token on restart. Recopy the token from the Runs page after restarting the API.

## Security

- The extension only asks for LoopNet and localhost API host permissions.
- It captures the current page URL, HTML, title, visible text preview, image URLs, link URLs, and meta tags.
- It does not read cookies, localStorage, sessionStorage, saved passwords, or auth headers.
- It does not bypass CAPTCHA, paywalls, sign-in gates, or protected downloads.
- The local API requires `X-LoopNet-Capture-Token` and rejects non-LoopNet listing URLs.
