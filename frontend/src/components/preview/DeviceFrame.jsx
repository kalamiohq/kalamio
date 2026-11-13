import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The iframe's document comes from `srcdoc`, not the about:blank document a src-less iframe starts with:
//  - A request made from an about:blank document carries no Referer (about: is a local scheme), and
//    YouTube refuses to play without one ("Error 153"). A srcdoc document takes its referrer from the
//    page holding the iframe, so embeds in the preview load as they do on the article page.
//  - The doctype renders it in standards mode, like the real page. about:blank renders in quirks mode.
export const FRAME_DOC = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';

const syncTheme = (doc) => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) doc.documentElement.setAttribute("data-theme", t);
    else doc.documentElement.removeAttribute("data-theme");
};

/**
 * Renders `children` inside a same-origin <iframe> whose viewport width equals the chosen device
 * width — so the app's VIEWPORT media queries (max-md / sm / lg …) genuinely fire at that width and
 * the preview shows the real responsive layout, not a desktop layout squeezed into a narrow box.
 *
 * The parent document's stylesheets are cloned into the iframe (both the <style> tags Vite/HMR inject
 * in dev and the <link rel=stylesheet> in a production build), and the light/dark theme is mirrored
 * (the app sets data-theme="light" on <html> for light and removes it for dark) — kept in lockstep
 * while the preview is open. React children are portaled into the iframe's <body>, so context
 * (Router, etc.) still works across the boundary.
 */
const DeviceFrame = ({ device = "laptop", width = "100%", children }) => {
    const frameRef = useRef(null);
    const [body, setBody] = useState(null);

    // Runs when the srcdoc document has loaded. React attaches onLoad before the iframe is inserted, so
    // the event can't fire unseen. It re-copies from scratch, so running it twice is harmless.
    const setup = useCallback(() => {
        const doc = frameRef.current?.contentDocument;
        if (!doc?.body) return;
        doc.head.querySelectorAll("[data-preview-style]").forEach((n) => n.remove());
        // Snapshot every same-origin rule via the CSSOM. This captures ALL app CSS — Tailwind
        // utilities AND custom rules — regardless of how Vite/HMR injected it (inline <style>,
        // <link>, constructed sheets), which a plain cloneNode of <style>/<link> can miss.
        let cssText = "";
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) cssText += rule.cssText + "\n";
            } catch { /* cross-origin sheet — unreadable; the cloned <link> below covers it */ }
        }
        if (cssText) {
            const style = doc.createElement("style");
            style.setAttribute("data-preview-style", "");
            style.textContent = cssText;
            doc.head.appendChild(style);
        }
        // Also clone stylesheet <link>s so any cross-origin sheet (e.g. a font CDN) still loads.
        document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
            const clone = node.cloneNode(true);
            clone.setAttribute("data-preview-style", "");
            doc.head.appendChild(clone);
        });
        doc.body.style.margin = "0";
        doc.body.style.minHeight = "100vh";
        doc.body.style.background = getComputedStyle(document.body).backgroundColor;
        syncTheme(doc);
        setBody(doc.body);
    }, []);

    // Keep the iframe's theme matching if the user toggles light/dark while previewing.
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const doc = frameRef.current?.contentDocument;
            if (doc) syncTheme(doc);
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observer.disconnect();
    }, []);

    return (
        <div className={`device-frame device-frame--${device}`}>
            <iframe
                ref={frameRef}
                srcDoc={FRAME_DOC}
                onLoad={setup}
                aria-label="Device preview"
                className="device-frame__iframe"
                style={{ width }}
            />
            {body && createPortal(children, body)}
        </div>
    );
};

export default DeviceFrame;
