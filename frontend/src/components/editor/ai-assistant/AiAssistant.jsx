import { useContext, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import toast from "react-hot-toast";
import { EditorContext } from "../../../pages/editor.pages";
import Icon from "../../Icon";
import Loader from "../../loader.component";
import AiProviderForm, { FIELD_CLASS } from "./AiProviderForm";
import AiSettings from "./AiSettings";
import AiInlineSuggestion from "./AiInlineSuggestion";
import AiFixesInChat from "./AiFixesInChat";
import { useAiConversation } from "./useAiConversation";
import { useLauncherNudges } from "./useLauncherNudges";
import { useAiSettings } from "../../../hooks/queries/useAiSettings";
import { useUpdateAiProvider, aiErrorMessage } from "../../../hooks/mutations/useAiSettingsMutations";
import { describeTarget } from "../../../common/ai-editor";

const TOOLTIP = "AI-powered writing and research assistance";
const SUGGESTIONS = ["Suggest a stronger title", "Tighten my introduction", "Write a closing paragraph for my article"];
const MESSAGE_CHARS = 8000; // mirrors server AI_LIMITS.messageChars
const OPERATION_LABEL = { insert: "Insert", append: "Append", replace: "Replace", edit: "Fix text" };

/**
 * Kalamio AI Assistant — a floating launcher plus a right-hand sidebar on the article editor.
 * Provider keys live (encrypted) on the server; every request goes through POST /ai/chat, which
 * compacts older context, applies guardrails and streams the reply back as SSE (see common/ai-chat.js).
 * Article edits arrive as proposals reviewed INSIDE the article (AiInlineSuggestion): green =
 * proposed (editable), red = would be removed, applied only on "Apply Changes".
 *
 * Desktop (lg+): the sidebar docks below the navbar and the editor shifts left to stay visible
 * (BlogEditor applies the margin). Smaller screens: it opens as a full-screen sheet.
 */
const AiAssistant = ({ open, onOpenChange }) => {
    const { blog, textEditor } = useContext(EditorContext);
    const { data: settings, isLoading, isError, refetch } = useAiSettings();
    const update = useUpdateAiProvider();

    const [view, setView] = useState("main"); // 'main' | 'settings'
    const [prompt, setPrompt] = useState("");
    const logRef = useRef(null);
    const uid = useId();
    const launcherRef = useRef(null);
    const headingRef = useRef(null);
    const wasOpen = useRef(open);
    const reduceMotion = useReducedMotion();

    // Move focus into the panel on open, and back to the launcher on close.
    useEffect(() => {
        if (open) headingRef.current?.focus();
        else if (wasOpen.current) launcherRef.current?.focus();
        wasOpen.current = open;
    }, [open]);

    // A random prompt pops up beside the launcher now and then while the panel is closed.
    const { nudge, dismiss: dismissNudges } = useLauncherNudges(open);

    const catalog = settings?.catalog || [];
    const connected = catalog.filter(p => settings.providers.some(s => s.provider === p.id));
    const activeSaved = settings?.providers.find(s => s.provider === settings.active_provider);
    const activeProvider = activeSaved && catalog.find(p => p.id === activeSaved.provider);

    const { messages, context, streaming, send, approve, cancel, retry, stop, reset, markUnavailable } = useAiConversation({
        editor: textEditor, title: blog?.title, provider: activeSaved?.provider, model: activeSaved?.model,
    });
    // At most one proposal awaits review at a time (a new message supersedes it).
    const reviewing = messages.find(m => m.proposal && ["pending", "checking"].includes(m.proposalState?.status) && !m.proposalState.unavailable);

    // "Show in article": on phones the panel covers the editor, so close it first.
    const showInArticle = (proposalId) => {
        if (window.innerWidth < 1024) onOpenChange(false);
        requestAnimationFrame(() => document.getElementById(`ai-suggestion-${proposalId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    };

    // Keep the newest text in view while a reply streams in.
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [messages]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (activeSaved && send(prompt)) setPrompt("");
    };
    const handlePromptKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) handleSubmit(e);
    };

    const handleModelChange = (e) => {
        const [provider, model] = e.target.value.split(":");
        update.mutate({ provider, model }, {
            onSuccess: () => provider !== activeSaved?.provider && toast.success(`Switched to ${catalog.find(p => p.id === provider).name}`),
            onError: (err) => toast.error(aiErrorMessage(err, "Couldn't switch models. Please try again.")),
        });
    };

    const copy = (text) => navigator.clipboard?.writeText(text).then(
        () => toast.success("Copied"),
        () => toast.error("Couldn't copy"),
    );

    const renderBody = () => {
        if (isLoading) return <Loader />;
        if (isError) {
            return (
                <div className="flex flex-col items-start gap-3">
                    <p className="text-black">Couldn't load your AI settings.</p>
                    <button type="button" onClick={() => refetch()} className="rounded-full border border-border px-4 py-2 text-black hover:bg-grey">Try again</button>
                </div>
            );
        }
        if (!settings.enabled) {
            return <p className="text-dark-grey">The AI assistant isn't available on this server yet.</p>;
        }
        if (view === "settings") return <AiSettings settings={settings} />;
        if (!activeProvider) {
            return (
                <div className="flex flex-col gap-4">
                    <div>
                        <p className="text-xl font-semibold text-black">Connect an AI provider</p>
                        <p className="text-sm text-dark-grey mt-1">Choose a provider and model, then add your API key to start using the assistant.</p>
                    </div>
                    <AiProviderForm settings={settings} />
                </div>
            );
        }
        if (messages.length === 0) {
            return (
                <div className="flex flex-col gap-4">
                    <div>
                        <p className="text-xl font-semibold text-black">How can I help with your article?</p>
                        <p className="text-sm text-dark-grey mt-1">Writing and research help, powered by your own {activeProvider.name} key. Your current draft is shared as context.</p>
                    </div>
                    <ul className="flex flex-col gap-2" aria-label="Suggested prompts">
                        {SUGGESTIONS.map(s => (
                            <li key={s}>
                                <button type="button" onClick={() => setPrompt(s)}
                                    className="w-full flex items-center gap-2 rounded-radius-md border border-border px-3 py-2.5 text-left text-black hover:bg-grey transition-colors">
                                    <Icon name="lightbulb" className="text-base text-dark-grey" />{s}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }
        return (
            // aria-busy holds screen-reader announcements until a reply finishes, instead of per token.
            <ol className="flex flex-col gap-4" role="log" aria-label="Conversation" aria-busy={streaming}>
                {messages.map((m) => {
                    if (m.role === "tool") return null; // outcomes are shown on the proposal card
                    const item = m.role === "user" ? (
                        <li key={m.id} className="self-end max-w-[85%] rounded-radius-md bg-grey px-3 py-2 text-black whitespace-pre-wrap break-words">
                            {m.content}
                        </li>
                    ) : (
                        <li key={m.id} className="flex flex-col gap-1.5">
                            {m.status === "blocked" || m.status === "error" ? (
                                <div role="alert" className={`flex items-start gap-2 rounded-radius-md border px-3 py-2 text-sm ${m.status === "blocked" ? "border-warning/50 text-black" : "border-red/40 text-red"}`}>
                                    <Icon name={m.status === "blocked" ? "shield" : "error"} className={`text-base mt-px ${m.status === "blocked" ? "text-warning" : ""}`} />
                                    <span>{m.content}</span>
                                </div>
                            ) : (m.content || !m.proposal) && (
                                <div className="text-black whitespace-pre-wrap break-words leading-relaxed">
                                    {m.content || (m.status === "streaming"
                                        ? <span className="text-dark-grey animate-pulse">{m.note || "Thinking…"}</span>
                                        : <span className="text-dark-grey">{m.notice ? "" : "Stopped."}</span>)}
                                </div>
                            )}
                            {m.content && m.note && m.status === "streaming" && <p className="text-sm text-dark-grey animate-pulse">{m.note}</p>}
                            {m.notice && (
                                <p className="flex items-start gap-1.5 text-sm text-dark-grey">
                                    <Icon name="info" className="text-sm mt-px" />{m.notice}
                                </p>
                            )}
                            {m.proposal?.operation === "edit" && !m.proposalState.unavailable && ["pending", "checking"].includes(m.proposalState.status) ? (
                                // Text fixes are reviewed and approved right here; the article only highlights them.
                                <AiFixesInChat
                                    editor={textEditor}
                                    message={m}
                                    busy={streaming}
                                    onApply={approve}
                                    onCancel={cancel}
                                    onJump={() => { if (window.innerWidth < 1024) onOpenChange(false); }}
                                />
                            ) : m.proposal && (
                                // Content changes are reviewed in the article (AiInlineSuggestion); this is their summary.
                                <div className="flex flex-col gap-1.5 rounded-radius-md border border-border bg-surface p-3 text-sm">
                                    <span className="flex items-center gap-1.5 font-semibold text-black">
                                        <Icon name="edit_note" className="text-base" />
                                        Suggested change: {m.proposal.target.type === "entire_article" ? "Replace entire draft" : OPERATION_LABEL[m.proposal.operation]}
                                    </span>
                                    <span className="text-dark-grey">{describeTarget(m.proposal.target)}</span>
                                    {m.proposalState.unavailable ? (
                                        <>
                                            <span role="alert" className="flex items-start gap-1.5 text-red">
                                                <Icon name="error" className="text-sm mt-px" />{m.proposalState.error}
                                            </span>
                                            <button type="button" onClick={() => cancel(m.id)} className="self-start rounded-full bg-grey px-3 py-1 font-medium text-black hover:bg-border">
                                                Dismiss
                                            </button>
                                        </>
                                    ) : ["pending", "checking"].includes(m.proposalState.status) ? (
                                        <>
                                            <span className="text-dark-grey">
                                                Review it in your article: the suggestion is <span className="font-medium text-success">green</span>
                                                {["replace", "edit"].includes(m.proposal.operation) ? <>, and what it replaces is <span className="font-medium text-red">red</span></> : null}.
                                            </span>
                                            <button type="button" onClick={() => showInArticle(m.proposal.id)}
                                                className="self-start flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium text-black hover:bg-grey">
                                                <Icon name="visibility" className="text-sm" /> Show in article
                                            </button>
                                        </>
                                    ) : (
                                        <span className={`flex items-center gap-1.5 ${m.proposalState.status === "applied" ? "text-success" : "text-dark-grey"}`}>
                                            <Icon name={m.proposalState.status === "applied" ? "check_circle" : m.proposalState.status === "failed" ? "error" : "close"} className="text-sm" />
                                            {m.proposalState.status === "applied" ? "Applied to your article."
                                                : m.proposalState.status === "failed" ? `Not applied: ${m.proposalState.error}` : "Cancelled. Your article wasn't changed."}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="flex gap-1">
                                {m.status === "done" && m.content && (
                                    <button type="button" onClick={() => copy(m.content)} aria-label="Copy response"
                                        className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-dark-grey hover:text-black hover:bg-grey">
                                        <Icon name="content_copy" className="text-sm" /> Copy
                                    </button>
                                )}
                                {m.status === "stopped" && <span className="px-2 text-sm text-dark-grey">Stopped</span>}
                                {m.status === "error" && !streaming && (
                                    <button type="button" onClick={() => retry(m.id)}
                                        className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-dark-grey hover:text-black hover:bg-grey">
                                        <Icon name="refresh" className="text-sm" /> Retry
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                    // Mark where older messages were folded into the assistant's summary (they stay visible here).
                    return context?.through === m.id ? [item, (
                        <li key={`${m.id}-summary`} className="flex items-center gap-2 text-xs text-dark-grey" aria-label="Earlier messages summarized">
                            <span className="h-px flex-1 bg-border" />Earlier messages summarized for the assistant<span className="h-px flex-1 bg-border" />
                        </li>
                    )] : item;
                })}
            </ol>
        );
    };

    const canChat = Boolean(settings?.enabled && activeProvider && view === "main");

    return (
        <>
            {/* The proposal under review lives in the article, not the panel — it stays visible when the panel closes. */}
            {reviewing && (
                <AiInlineSuggestion
                    key={reviewing.proposal.id}
                    editor={textEditor}
                    message={reviewing}
                    busy={streaming}
                    onApply={approve}
                    onCancel={cancel}
                    onUnavailable={markUnavailable}
                />
            )}

            {/* Launcher. Own tooltip (not CustomTooltip): that one renders below/centred and would fall
                off-screen for a bottom-right button. */}
            <div className={`fixed bottom-6 right-6 z-40 group ${open ? "hidden" : ""}`}>
                <button
                    ref={launcherRef}
                    type="button"
                    onClick={() => onOpenChange(true)}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-lg hover:opacity-90 active:scale-95 transition"
                    aria-label="Open Kalamio AI Assistant"
                    aria-describedby={`${uid}-tip`}
                    aria-expanded={open}
                    aria-controls={`${uid}-panel`}
                >
                    <Icon name="smart_toy" className="text-2xl" />
                </button>
                <span
                    id={`${uid}-tip`}
                    role="tooltip"
                    className={`pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-full bg-black px-3 py-1.5 text-sm font-medium text-white opacity-0 shadow-md transition-opacity ${nudge ? "" : "group-hover:opacity-100 group-focus-within:opacity-100"}`}
                >
                    {TOOLTIP}
                </span>
                <AnimatePresence>
                    {nudge && (
                        <motion.div
                            key={nudge}
                            initial={reduceMotion ? false : { opacity: 0, x: 8, scale: 0.96 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                            transition={{ duration: 0.2 }}
                            className="absolute right-full bottom-1 mr-3 flex items-center gap-1 rounded-radius-lg rounded-br-sm bg-white border border-border shadow-lg pl-3 pr-1 py-1"
                        >
                            <button type="button" onClick={() => onOpenChange(true)} className="whitespace-nowrap py-1 text-sm font-medium text-black hover:underline">
                                {nudge}
                            </button>
                            <button type="button" onClick={dismissNudges} aria-label="Dismiss AI assistant tips"
                                className="w-7 h-7 flex items-center justify-center rounded-full text-dark-grey hover:text-black hover:bg-grey">
                                <Icon name="close" className="text-sm" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {open && (
                <motion.aside
                    id={`${uid}-panel`}
                    aria-labelledby={`${uid}-title`}
                    initial={reduceMotion ? false : { opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}
                    className="fixed inset-0 z-[60] flex flex-col bg-white lg:inset-auto lg:top-[80px] lg:right-0 lg:bottom-0 lg:z-40 lg:w-[380px] lg:border-l lg:border-border"
                >
                    {/* Header */}
                    <header className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
                        {view === "settings" ? (
                            <button type="button" onClick={() => setView("main")} aria-label="Back to assistant"
                                className="w-9 h-9 -ml-2 flex items-center justify-center rounded-full text-dark-grey hover:text-black hover:bg-grey">
                                <Icon name="arrow_back" className="text-xl" />
                            </button>
                        ) : (
                            <span className="w-8 h-8 flex items-center justify-center rounded-full bg-black text-white">
                                <Icon name="smart_toy" className="text-lg" />
                            </span>
                        )}
                        <h2 id={`${uid}-title`} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-black outline-none">
                            Kalamio AI Assistant
                        </h2>
                        {view === "main" && messages.length > 0 && !streaming && (
                            <button type="button" onClick={reset} aria-label="Start a new chat"
                                className="ml-auto w-9 h-9 flex items-center justify-center rounded-full text-dark-grey hover:text-black hover:bg-grey">
                                <Icon name="edit_note" className="text-xl" />
                            </button>
                        )}
                        <button type="button" onClick={() => onOpenChange(false)} aria-label="Close AI assistant"
                            className={`${view === "main" && messages.length > 0 && !streaming ? "" : "ml-auto "}w-9 h-9 flex items-center justify-center rounded-full text-dark-grey hover:text-black hover:bg-grey`}>
                            <Icon name="close" className="text-xl" />
                        </button>
                    </header>

                    {/* Body */}
                    <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-5">
                        {renderBody()}
                    </div>

                    {/* Composer: model switcher + settings, with the prompt box below once a provider is connected */}
                    {settings?.enabled && (
                    <div className="flex flex-col gap-2 px-4 py-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <label htmlFor={`${uid}-model`} className="sr-only">Model</label>
                        <select
                            id={`${uid}-model`}
                            className={`${FIELD_CLASS} py-2 text-sm`}
                            value={activeSaved ? `${activeSaved.provider}:${activeSaved.model}` : ""}
                            onChange={handleModelChange}
                            disabled={!activeProvider || streaming || update.isPending}
                        >
                            {!activeProvider && <option value="">No model connected</option>}
                            {connected.map(p => (
                                <optgroup key={p.id} label={p.name}>
                                    {p.models.map(m => <option key={m.id} value={`${p.id}:${m.id}`}>{m.name}</option>)}
                                </optgroup>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setView(v => v === "settings" ? "main" : "settings")}
                            aria-label="Manage AI providers and API keys"
                            aria-pressed={view === "settings"}
                            className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-full border border-border hover:bg-grey ${view === "settings" ? "bg-grey text-black" : "text-dark-grey"}`}
                        >
                            <Icon name="settings" className="text-lg" />
                        </button>
                    </div>

                    {canChat && (
                        <form onSubmit={handleSubmit}>
                            <label htmlFor={`${uid}-prompt`} className="sr-only">Ask Kalamio AI</label>
                            <div className="relative">
                                <textarea
                                    id={`${uid}-prompt`}
                                    rows={3}
                                    value={prompt}
                                    maxLength={MESSAGE_CHARS}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={handlePromptKeyDown}
                                    placeholder="Ask for writing help or research…"
                                    className={`${FIELD_CLASS} resize-none pr-12 rounded-radius-md`}
                                />
                                {streaming ? (
                                    <button type="button" onClick={stop} aria-label="Stop generating"
                                        className="absolute right-2 bottom-2.5 w-9 h-9 flex items-center justify-center rounded-full bg-black text-white hover:opacity-80 transition-opacity">
                                        <Icon name="pause_circle" className="text-base" />
                                    </button>
                                ) : (
                                    <button type="submit" disabled={!prompt.trim()} aria-label="Send"
                                        className="absolute right-2 bottom-2.5 w-9 h-9 flex items-center justify-center rounded-full bg-black text-white disabled:opacity-30 hover:opacity-80 transition-opacity">
                                        <Icon name="send" className="text-base" />
                                    </button>
                                )}
                            </div>
                        </form>
                    )}
                    </div>
                    )}
                </motion.aside>
            )}
        </>
    );
};

export default AiAssistant;
