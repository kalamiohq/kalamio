import { useId, useState } from "react";
import toast from "react-hot-toast";
import Icon from "../../Icon";
import { useUpdateAiProvider, aiErrorMessage } from "../../../hooks/mutations/useAiSettingsMutations";

export const FIELD_CLASS = "w-full rounded-radius-sm bg-grey border border-border px-3 py-2.5 text-base text-black";
const LABEL_CLASS = "block text-sm font-medium text-dark-grey mb-1.5";

/** Shown wherever a key is entered or managed, so how keys are handled is never a surprise. */
export const AiPrivacyNote = () => (
    <div className="flex gap-2.5 rounded-radius-md border border-border bg-surface p-3 text-sm leading-relaxed text-dark-grey">
        <Icon name="lock" className="text-base text-black mt-0.5" />
        <p className="text-sm">
            <span className="font-semibold text-black">How we handle your key.</span>{" "}
            Your API key is encrypted and stored with your Kalamio account, so it works on any device you sign in
            to. It's only used to send your assistant requests to the provider you choose, and it's never shown
            again. We display just its last 4 characters. Requests go to that provider under your own account
            and billing. Remove the key here at any time.
        </p>
    </div>
);

/**
 * Add or update one provider's key + model (first-time setup and Settings).
 * When the provider is already connected, leaving the key blank keeps the saved one, so switching
 * models never forces a re-paste. Key-format validation happens on the server.
 */
const AiProviderForm = ({ settings, initialProviderId, lockProvider = false, onDone, onCancel }) => {
    const uid = useId();
    const { catalog, providers } = settings;
    const savedFor = (id) => providers.find(p => p.provider === id);
    const providerOf = (id) => catalog.find(p => p.id === id);
    const defaultModel = (id) => {
        const saved = savedFor(id)?.model;
        const models = providerOf(id).models;
        return models.some(m => m.id === saved) ? saved : models[0].id;
    };

    const [providerId, setProviderId] = useState(initialProviderId || settings.active_provider || catalog[0].id);
    const [model, setModel] = useState(() => defaultModel(providerId));
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState("");
    const update = useUpdateAiProvider();

    const provider = providerOf(providerId);
    const existing = savedFor(providerId);

    const changeProvider = (id) => {
        setProviderId(id);
        setModel(defaultModel(id));
        setApiKey("");
        setError("");
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const key = apiKey.trim();
        if (!key && !existing) return setError("Enter your API key.");
        if (/\s/.test(key)) return setError("API keys can't contain spaces.");
        update.mutate(
            { provider: providerId, model, ...(key ? { apiKey: key } : {}) },
            {
                onSuccess: () => {
                    setApiKey("");
                    toast.success(existing ? `${provider.name} settings updated` : `${provider.name} connected`);
                    onDone?.();
                },
                onError: (err) => setError(aiErrorMessage(err, "Couldn't save your key. Please try again.")),
            },
        );
    };

    const errorId = `${uid}-error`;

    return (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div>
                <label htmlFor={`${uid}-provider`} className={LABEL_CLASS}>AI provider</label>
                <select id={`${uid}-provider`} className={FIELD_CLASS} value={providerId} disabled={lockProvider}
                    onChange={(e) => changeProvider(e.target.value)}>
                    {catalog.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>

            <div>
                <label htmlFor={`${uid}-model`} className={LABEL_CLASS}>Model</label>
                <select id={`${uid}-model`} className={FIELD_CLASS} value={model} onChange={(e) => setModel(e.target.value)}>
                    {provider.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
            </div>

            <div>
                <label htmlFor={`${uid}-key`} className={LABEL_CLASS}>{provider.name} API key</label>
                <div className="relative">
                    <input
                        id={`${uid}-key`}
                        type={showKey ? "text" : "password"}
                        className={`${FIELD_CLASS} pr-11 font-mono ${error ? "!border-red" : ""}`}
                        value={apiKey}
                        onChange={(e) => { setApiKey(e.target.value); setError(""); }}
                        placeholder={existing ? `Leave blank to keep ••••${existing.key_last4}` : `${provider.keyPrefix}…`}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(s => !s)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-dark-grey hover:text-black hover:bg-border/60"
                        aria-label={showKey ? "Hide API key" : "Show API key"}
                        aria-pressed={showKey}
                    >
                        <Icon name={showKey ? "visibility_off" : "visibility"} className="text-lg" />
                    </button>
                </div>
                {error ? (
                    <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-red">
                        <Icon name="error" className="text-sm mt-px" />{error}
                    </p>
                ) : (
                    <a href={provider.keysUrl} target="_blank" rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-sm text-dark-grey underline hover:text-black">
                        Get a {provider.name} API key <Icon name="open_in_new" className="text-sm" />
                    </a>
                )}
            </div>

            <AiPrivacyNote />

            <div className="flex gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="flex-1 rounded-full bg-grey py-2.5 font-medium text-black hover:bg-border">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={update.isPending}
                    className="flex-1 rounded-full bg-black py-2.5 font-semibold text-white hover:opacity-80 disabled:opacity-50 transition-opacity">
                    {update.isPending ? "Saving…" : existing ? "Save changes" : "Save & connect"}
                </button>
            </div>
        </form>
    );
};

export default AiProviderForm;
