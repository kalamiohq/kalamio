import { useState } from "react";
import toast from "react-hot-toast";
import Icon from "../../Icon";
import AiProviderForm, { AiPrivacyNote } from "./AiProviderForm";
import { useUpdateAiProvider, useRemoveAiProvider, aiErrorMessage } from "../../../hooks/mutations/useAiSettingsMutations";

/** Manage every provider: add/update keys, pick the active one, remove keys. */
const AiSettings = ({ settings }) => {
    const [editingId, setEditingId] = useState(null);
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);
    const update = useUpdateAiProvider();
    const remove = useRemoveAiProvider();
    const busy = update.isPending || remove.isPending;

    const activate = (p, saved) => update.mutate(
        { provider: p.id, model: saved.model },
        {
            onSuccess: () => toast.success(`Now using ${p.name}`),
            onError: (err) => toast.error(aiErrorMessage(err)),
        },
    );

    const removeKey = (p) => remove.mutate(
        { provider: p.id },
        {
            onSuccess: () => { setConfirmRemoveId(null); toast.success(`${p.name} key removed`); },
            onError: (err) => toast.error(aiErrorMessage(err)),
        },
    );

    if (editingId) {
        const p = settings.catalog.find(c => c.id === editingId);
        return (
            <div className="flex flex-col gap-4">
                <h3 className="text-xl font-semibold text-black">
                    {settings.providers.some(s => s.provider === editingId) ? "Update" : "Add"} {p.name}
                </h3>
                <AiProviderForm
                    settings={settings}
                    initialProviderId={editingId}
                    lockProvider
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h3 className="text-xl font-semibold text-black">AI providers</h3>
                <p className="text-sm text-dark-grey mt-1">Add a key for each provider you want to use, then pick one as active.</p>
            </div>

            <ul className="flex flex-col gap-2.5">
                {settings.catalog.map(p => {
                    const saved = settings.providers.find(s => s.provider === p.id);
                    const isActive = settings.active_provider === p.id && Boolean(saved);
                    const modelName = p.models.find(m => m.id === saved?.model)?.name || saved?.model;
                    return (
                        <li key={p.id} className={`rounded-radius-md border p-3 ${isActive ? "border-black/40 bg-surface" : "border-border"}`}>
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-black">{p.name}</span>
                                {isActive && <span className="rounded-full bg-black px-2 py-0.5 text-xs font-semibold text-white">Active</span>}
                                <span className={`ml-auto flex items-center gap-1 text-sm ${saved ? "text-success" : "text-dark-grey"}`}>
                                    <Icon name={saved ? "check_circle" : "key"} className="text-sm" />
                                    {saved ? "Connected" : "Not set up"}
                                </span>
                            </div>
                            {saved && (
                                <p className="mt-1 text-sm text-dark-grey">
                                    <span className="font-mono">••••{saved.key_last4}</span> · {modelName}
                                </p>
                            )}

                            {confirmRemoveId === p.id ? (
                                <div className="mt-3 flex items-center gap-2" role="group" aria-label={`Confirm removing ${p.name} key`}>
                                    <span className="text-sm text-black mr-auto">Remove this key?</span>
                                    <button type="button" onClick={() => setConfirmRemoveId(null)} className="rounded-full bg-grey px-3 py-1.5 text-sm font-medium text-black hover:bg-border">Cancel</button>
                                    <button type="button" disabled={busy} onClick={() => removeKey(p)} className="rounded-full bg-red px-3 py-1.5 text-sm font-semibold text-[#fff] hover:opacity-90 disabled:opacity-50">Remove</button>
                                </div>
                            ) : (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {saved && !isActive && (
                                        <button type="button" disabled={busy} onClick={() => activate(p, saved)} className="rounded-full bg-black px-3 py-1.5 text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50">
                                            Use {p.name}
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setEditingId(p.id)} className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-black hover:bg-grey">
                                        {saved ? "Update key or model" : "Add key"}
                                    </button>
                                    {saved && (
                                        <button type="button" onClick={() => setConfirmRemoveId(p.id)} className="rounded-full px-3 py-1.5 text-sm font-medium text-red hover:bg-red/10"
                                            aria-label={`Remove ${p.name} key`}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <AiPrivacyNote />
        </div>
    );
};

export default AiSettings;
