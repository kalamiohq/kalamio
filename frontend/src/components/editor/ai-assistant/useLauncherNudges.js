import { useEffect, useState } from "react";

// Occasional prompts beside the AI launcher so writers discover the assistant.
export const NUDGES = [
    "Need a hand with this draft?",
    "Want me to research this topic?",
    "Stuck on a title? I can suggest a few.",
    "I can tighten your introduction.",
    "Need a closing paragraph?",
    "Want a quick fact-check?",
    "Writer's block? Ask me for ideas.",
];
export const NUDGE_FIRST_MS = 20_000;
export const NUDGE_EVERY_MS = 75_000;
export const NUDGE_VISIBLE_MS = 7_000;

/**
 * A random nudge pops up NUDGE_FIRST_MS after the editor opens, then every NUDGE_EVERY_MS, each shown
 * for NUDGE_VISIBLE_MS (never the same one twice in a row, never in a background tab). Nudging stops
 * for the session once the assistant has been opened or a nudge is dismissed.
 * @returns {{ nudge: string | null, dismiss: () => void }}
 */
export const useLauncherNudges = (open) => {
    const [nudge, setNudge] = useState(null);
    const [off, setOff] = useState(false);

    useEffect(() => { if (open) setOff(true); }, [open]);

    useEffect(() => {
        if (open || off) { setNudge(null); return undefined; }
        let every;
        let hide;
        const show = () => {
            if (document.hidden) return;
            setNudge(prev => {
                const options = NUDGES.filter(n => n !== prev);
                return options[Math.floor(Math.random() * options.length)];
            });
            clearTimeout(hide);
            hide = setTimeout(() => setNudge(null), NUDGE_VISIBLE_MS);
        };
        const first = setTimeout(() => { show(); every = setInterval(show, NUDGE_EVERY_MS); }, NUDGE_FIRST_MS);
        return () => { clearTimeout(first); clearInterval(every); clearTimeout(hide); };
    }, [open, off]);

    return { nudge, dismiss: () => setOff(true) };
};
