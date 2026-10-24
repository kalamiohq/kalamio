import { Link, useNavigate, useParams } from "react-router-dom";
import Logo from "./Logo";
import AnimationWrapper from "../common/page-animation";
import lightBanner from "../imgs/blog banner light.png";
import darkBanner from "../imgs/blog banner dark.png";
import { uploadImage } from "../common/aws";
import { useContext, useEffect, useRef, useCallback, useState } from "react";
import toast from "react-hot-toast";
import { EditorContext } from "../pages/editor.pages";
import TiptapEditor from "./editor/TiptapEditor";
import SaveStatus from "./editor/SaveStatus";
import { blogSignature, blogIsMeaningful } from "../hooks/useDraftAutosave";
import ConfirmModal from "./confirm-modal.component";
import api from "../common/api";
import { ThemeContext, UserContext } from "../App";
import Icon from "./Icon";
import Avatar from "./Avatar";
import Loader from "./loader.component";
import { getDay } from "../common/date";
import ImageCropperModal from "./image-cropper.component";
import PublishSteps from "./publish-steps.component";
import PreviewButton from "./preview/PreviewButton";

// The article banner displays 2:1 on desktop (aspect-[2/1], object-cover), so crop to that ratio.
const ARTICLE_BANNER_ASPECT = 2;

const blogStructure = {
    title: "",
    banner: "",
    content: [],
    tags: [],
    des: "",
    author: { personal_info: { } }
};

const BlogEditor = () => {

    let { blog, setBlog, setTextEditor, setEditorState, saveStatus, savedAt, clearLocalDraft, setServerContentSig } = useContext(EditorContext);
    let { title, banner, content, tags, des } = blog;

    let { userAuth: { access_token, profile_img, fullname } } = useContext(UserContext);
    let { theme } = useContext(ThemeContext);
    let { blog_id } = useParams();

    let navigate = useNavigate();

    // Ref to hold the Tiptap editor instance
    const editorRef = useRef(null);

    // Object URL of the banner image currently being cropped (null = cropper closed).
    const [bannerToCrop, setBannerToCrop] = useState(null);

    // ── Draft state ──
    const [view, setView] = useState("editor"); // 'editor' | 'drafts'
    const [editingDraftId, setEditingDraftId] = useState(null);
    const [drafts, setDrafts] = useState(null);
    const [draftSearch, setDraftSearch] = useState("");
    const [loadingDrafts, setLoadingDrafts] = useState(false);
    const [draftMenuOpen, setDraftMenuOpen] = useState(null);
    const [showDraftPopup, setShowDraftPopup] = useState(null); // 'save' | 'update' | null
    const [confirmState, setConfirmState] = useState(null); // { title, message, confirmLabel, onConfirm } | null
    const searchTimeoutRef = useRef(null);
    const titleRef = useRef(null);

    const isEditingPublishedPost = Boolean(blog_id && blog?.draft === false);
    const isEditingDraft = Boolean(editingDraftId && !isEditingPublishedPost);

    // Sync editingDraftId with the loaded post status
    useEffect(() => {
        if (!blog_id) return;

        if (blog?.draft) {
            setEditingDraftId(blog_id);
        } else if (blog?.draft === false) {
            setEditingDraftId(null);
        }
    }, [blog_id, blog?.draft]);

    const handleEditorReady = useCallback((editor) => {
        editorRef.current = editor;
        setTextEditor(editor);
    }, [setTextEditor]);

    const handleEditorUpdate = useCallback((json) => {
        setBlog(prev => ({ ...prev, content: json }));
    }, [setBlog]);

    // ── Helpers ──
    // Must include the editor BODY, not just title/banner — otherwise paragraphs typed without a title
    // read as an "empty editor", the button says "Drafts" instead of "Save draft", and the destructive
    // paths below run with no save prompt. `blog.content` is kept current by handleEditorUpdate, so this
    // re-evaluates as the writer types.
    const hasContent = blogIsMeaningful(blog) || banner.length > 0;

    // Work that is NOT mirrored to the server: a brand-new post, or edits to a published post (server
    // autosave only runs for existing drafts). Discarding this loses it for good, so it needs a prompt.
    const hasUnsavedWork = hasContent && !isEditingDraft;

    const resetEditor = () => {
        setBlog({ ...blogStructure });
        setServerContentSig?.(null); // fresh new post — nothing on the server yet
        setEditingDraftId(null);
        if (editorRef.current) {
            editorRef.current.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
        }
        if (titleRef.current) {
            titleRef.current.value = "";
            titleRef.current.style.height = 'auto';
        }
        // Navigate to clean /editor URL without a blog_id
        navigate("/editor", { replace: true });
    };

    // ── Fetch drafts ──
    const fetchDrafts = useCallback((query = "") => {
        setLoadingDrafts(true);
        api.post("/user-written-blogs", {
            page: 1,
            draft: true,
            content_type: "blog",
            // This is the ONLY consumer that reloads a draft's full body into the editor (loadDraft →
            // draft.content), so it opts in to the heavy `content` field. The manage-blogs list and the
            // text-post picker omit it and get a lean projection (see userWrittenPosts).
            include_content: true,
            query: query || undefined
        }).then(({ data }) => {
            setDrafts(data.blogs || []);
        }).catch(() => {
            toast.error("Failed to load drafts");
            setDrafts([]);
        }).finally(() => {
            setLoadingDrafts(false);
        });
    }, []);

    // Fetch drafts when entering draft view
    useEffect(() => {
        if (view === "drafts") {
            fetchDrafts(draftSearch);
        }
    }, [view]);

    // Search drafts with debounce
    const handleDraftSearch = (val) => {
        setDraftSearch(val);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            fetchDrafts(val);
        }, 400);
    };

    // ── Load a draft into editor ──
    const loadDraft = (draft) => {
        // Set blog state
        const loaded = {
            title: draft.title || "",
            banner: draft.banner || "",
            content: draft.content || [],
            tags: draft.tags || [],
            des: draft.des || "",
            draft: true,
            author: draft.author || { personal_info: {} }
        };
        setBlog(loaded);
        // This switches the edited draft in place (no remount), so tell the autosave hook that the loaded
        // content is exactly what the server already holds — otherwise it would spuriously re-upload the
        // untouched draft and stamp it `edited`.
        setServerContentSig?.(blogSignature(loaded));
        setEditingDraftId(draft.blog_id);
        setDraftMenuOpen(null);
        setView("editor");

        // Update the title textarea
        if (titleRef.current) {
            titleRef.current.value = draft.title || "";
            titleRef.current.style.height = 'auto';
            titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
        }

        // Update the Tiptap editor content
        if (editorRef.current) {
            const normalized = Array.isArray(draft.content) ? draft.content[0] : draft.content;
            if (normalized?.type === 'doc') {
                editorRef.current.commands.setContent(normalized);
            } else {
                editorRef.current.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
            }
        }

        // Update URL without full page reload
        navigate(`/editor/${draft.blog_id}`, { replace: true });
    };

    // ── Delete a draft ──
    const deleteDraft = async (blogId) => {
        setDraftMenuOpen(null);
        const loadingToast = toast.loading("Deleting…");
        try {
            await api.post("/delete-blog", { blog_id: blogId });
            toast.dismiss(loadingToast);
            toast.success("Draft deleted");
            setDrafts(prev => prev.filter(d => d.blog_id !== blogId));
            // If we were editing this draft, reset
            if (editingDraftId === blogId) {
                resetEditor();
            }
        } catch {
            toast.dismiss(loadingToast);
            toast.error("Failed to delete draft");
        }
    };

    // ── Destructive actions, gated behind ConfirmModal ──
    const draftLabel = (draft) => draft.title || "Untitled draft";

    const requestNewPost = () => {
        const go = () => { resetEditor(); setView("editor"); };
        if (!hasUnsavedWork) return go();
        setConfirmState({
            title: "Discard current work?",
            message: "Your unsaved title and content will be lost. Save it as a draft first if you want to keep it.",
            confirmLabel: "Discard",
            onConfirm: () => { setConfirmState(null); go(); }
        });
    };

    const requestLoadDraft = (draft) => {
        if (!hasUnsavedWork) return loadDraft(draft);
        setConfirmState({
            title: "Discard current work?",
            message: `Opening "${draftLabel(draft)}" will replace your unsaved title and content.`,
            confirmLabel: "Discard & open",
            onConfirm: () => { setConfirmState(null); loadDraft(draft); }
        });
    };

    const requestDeleteDraft = (draft) => {
        setDraftMenuOpen(null);
        setConfirmState({
            title: "Delete this draft?",
            message: `"${draftLabel(draft)}" will be permanently deleted. This can't be undone.`,
            confirmLabel: "Delete",
            onConfirm: () => { setConfirmState(null); deleteDraft(draft.blog_id); }
        });
    };

    // ── Build draft payload ──
    const buildDraftPayload = () => {
        const editor = editorRef.current;
        const editorContent = editor ? editor.getJSON() : { type: 'doc', content: [] };
        return {
            title, banner, des, content: editorContent, tags, draft: true,
            ...(isEditingDraft ? { id: editingDraftId } : {})
        };
    };

    // ── Save draft and go to drafts list ──
    const saveDraftAndGoToList = async () => {
        setShowDraftPopup(null);
        if (isEditingPublishedPost) {
            toast.error("Published blogs can't be moved back to drafts");
            return;
        }
        if (!title.length) {
            toast.error("Write a title before saving as draft");
            return;
        }
        const loadingToast = toast.loading(isEditingDraft ? "Updating draft…" : "Saving draft…");
        try {
            const { data } = await api.post("/create-blog", buildDraftPayload());
            // Work is now safely on the server — drop the local safety-net snapshot so this saved draft
            // isn't later offered back as "unsaved work".
            clearLocalDraft?.();
            toast.dismiss(loadingToast);
            toast.success(isEditingDraft ? "Draft updated" : "Saved to drafts");
            // If new draft, set the editing ID
            if (!isEditingDraft && data.id) {
                setEditingDraftId(data.id);
                navigate(`/editor/${data.id}`, { replace: true });
            }
            setView("drafts");
            fetchDrafts("");
            setDraftSearch("");
        } catch (err) {
            toast.dismiss(loadingToast);
            // 413 (too long), 429, 5xx and offline are surfaced centrally by the api interceptor; only
            // show the server's specific message for ordinary 4xx rejections here (no double toast).
            const status = err?.response?.status;
            if (status && status < 500 && ![401, 413, 429].includes(status)) {
                toast.error(err.response.data?.error || "Failed to save draft");
            }
        }
    };

    // ── Don't save, just go to list ──
    const skipAndGoToList = () => {
        setShowDraftPopup(null);
        setView("drafts");
        fetchDrafts("");
        setDraftSearch("");
    };

    // ── Drafts button click logic (same as text-post) ──
    const handleDraftsClick = () => {
        if (isEditingPublishedPost) return;

        if (isEditingDraft) {
            // Editing existing draft
            if (hasContent) {
                setShowDraftPopup("update");
            } else {
                resetEditor();
                setView("drafts");
                fetchDrafts("");
            }
        } else if (hasContent) {
            // New post with content
            setShowDraftPopup("save");
        } else {
            // Empty editor
            setView("drafts");
            fetchDrafts("");
        }
    };

    // ── Existing handlers ──
    // Pick a file → open the cropper (don't upload the raw image). Reset the input so re-picking the
    // same file fires onChange again.
    const handleBanner = (e) => {
        const img = e.target.files[0];
        if (img) {
            if (!img.type.startsWith('image/')) {
                return toast.error("Please select an image file (.png, .jpg, .jpeg)");
            }
            setBannerToCrop(URL.createObjectURL(img));
        }
        e.target.value = null;
    }

    // Cropper returns the cropped 2:1 cover as a File → upload that.
    const handleBannerCropped = (croppedFile) => {
        setBannerToCrop(null);
        const loadingToast = toast.loading("Uploading…");
        uploadImage(croppedFile).then((url) => {
            if (url) {
                toast.dismiss(loadingToast);
                toast.success("Uploaded");
                setBlog({ ...blog, banner: url });
            }
        })
        .catch(err => {
            toast.dismiss(loadingToast);
            console.error("Banner upload error:", err);
            toast.error(err?.response?.data?.error || err.message || "Upload failed");
        })
    }

    const handleTitleKeyDown = (e) => {
        if(e.keyCode == 13){
            e.preventDefault();
        }
    }

    const handleTitleChange = (e) => {
        let input = e.target;

        input.style.height = 'auto';
        input.style.height = input.scrollHeight + "px";

        setBlog({ ...blog, title: input.value })
    }

    const handleImgError = (e) => {
        let img = e.target;

        img.src = theme === "light" ? lightBanner : darkBanner;
    }

    // Clear an uploaded cover back to the default placeholder. A banner is only required at publish
    // time (see publishBlog), so removing it mid-write is fine — autosave picks up the cleared value
    // like any other edit. stopPropagation so the click never falls through to the upload <label>.
    const handleRemoveBanner = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBlog({ ...blog, banner: "" });
        toast.success("Cover removed");
    }

    const handlePublishEvent = () => {

        if(!banner.length){
            return toast.error("Upload a blog banner to publish it");
        }

        if(!title.length){
            return toast.error("Write blog title to publish it");
        }

        // Get content from the Tiptap editor
        const editor = editorRef.current;
        if (editor) {
            const data = editor.getJSON();
            // Check if there's actual content (more than just an empty paragraph)
            const hasEditorContent = data.content && data.content.length > 0 && 
                !(data.content.length === 1 && data.content[0].type === 'paragraph' && !data.content[0].content);
            
            if (hasEditorContent) {
                setBlog({ ...blog, content: data });
                setEditorState("publish");
            } else {
                return toast.error("Write something in your blog to publish it");
            }
        }
    }

    // Prepare initial content for the editor
    const getInitialContent = () => {
        if (!content || (Array.isArray(content) && content.length === 0)) {
            return null; // New post — empty editor
        }
        const normalized = Array.isArray(content) ? content[0] : content;
        // Tiptap format
        if (normalized?.type === 'doc') {
            return normalized;
        }
        // EditorJS format — can't load in Tiptap
        if (normalized?.blocks) {
            toast.error("This post uses a legacy editor format. Content has been loaded as read-only. Please recreate if you need to edit.", { duration: 5000 });
            return null;
        }
        return null;
    };

    // ═══════════════════════════════════════════════════
    // DRAFTS OVERLAY VIEW
    // ═══════════════════════════════════════════════════
    if (view === "drafts") {
        return (
            <div className="editor-drafts-overlay">
                <div className="editor-drafts">

                    {/* Header */}
                    <div className="editor-drafts__header">
                        <button className="editor-drafts__back" onClick={() => setView("editor")}>
                            <Icon name="arrow_back" className="text-xl" />
                        </button>
                        <span className="editor-drafts__title">Drafts</span>
                        <div style={{ width: 36 }} />
                    </div>

                    {/* Search */}
                    <div className="editor-drafts__search">
                        <Icon name="search" className="editor-drafts__search-icon" />
                        <input
                            type="text"
                            className="editor-drafts__search-input"
                            placeholder="Search drafts..."
                            value={draftSearch}
                            onChange={(e) => handleDraftSearch(e.target.value)}
                        />
                        {draftSearch && (
                            <button className="editor-drafts__search-clear" onClick={() => { setDraftSearch(""); fetchDrafts(""); }}>
                                <Icon name="close" className="text-lg" />
                            </button>
                        )}
                    </div>

                    {/* Draft List */}
                    <div className="editor-drafts__list" onClick={() => setDraftMenuOpen(null)}>
                        {/* Create New button */}
                        <button className="editor-drafts__new-btn" onClick={requestNewPost}>
                            <div className="editor-drafts__new-icon">
                                <Icon name="add" className="text-xl" />
                            </div>
                            <span>Create new</span>
                        </button>

                        {loadingDrafts ? (
                            <div className="editor-drafts__empty">
                                <Loader />
                            </div>
                        ) : drafts && drafts.length === 0 ? (
                            <div className="editor-drafts__empty">
                                <Icon name="draft" className="text-3xl" style={{ opacity: 0.3 }} />
                                <span>{draftSearch ? "No matching drafts" : "No drafts yet"}</span>
                            </div>
                        ) : (
                            drafts && drafts.map(draft => (
                                <div key={draft.blog_id} className="editor-drafts__item" onClick={() => requestLoadDraft(draft)}>
                                    {/* Thumbnail */}
                                    {draft.banner ? (
                                        <div className="editor-drafts__item-thumb">
                                            <img src={draft.banner} alt="" />
                                        </div>
                                    ) : (
                                        <div className="editor-drafts__item-thumb editor-drafts__item-thumb--empty">
                                            <Icon name="article" className="text-xl" />
                                        </div>
                                    )}
                                    <div className="editor-drafts__item-content">
                                        <p className="editor-drafts__item-title">
                                            {draft.title || 'Untitled draft'}
                                        </p>
                                        <span className="editor-drafts__item-meta">
                                            {draft.publishedAt ? getDay(draft.publishedAt) : 'No date'}
                                            {draft.des && (
                                                <><span className="editor-drafts__dot">·</span>{draft.des.substring(0, 40)}{draft.des.length > 40 ? '...' : ''}</>
                                            )}
                                        </span>
                                    </div>
                                    <button className="editor-drafts__item-menu" onClick={(e) => {
                                        e.stopPropagation();
                                        setDraftMenuOpen(draftMenuOpen === draft.blog_id ? null : draft.blog_id);
                                    }}>
                                        <Icon name="more_horiz" />
                                    </button>

                                    {draftMenuOpen === draft.blog_id && (
                                        <div className="editor-drafts__item-dropdown">
                                            <button className="editor-drafts__item-dropdown-btn editor-drafts__item-dropdown-btn--delete"
                                                onClick={(e) => { e.stopPropagation(); requestDeleteDraft(draft); }}>
                                                <Icon name="delete" className="text-lg" /> Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                </div>

                <ConfirmModal
                    isOpen={Boolean(confirmState)}
                    title={confirmState?.title}
                    message={confirmState?.message}
                    confirmLabel={confirmState?.confirmLabel}
                    variant="danger"
                    onConfirm={confirmState?.onConfirm}
                    onCancel={() => setConfirmState(null)}
                />
            </div>
        );
    }

    // ═══════════════════════════════════════════════════
    // EDITOR VIEW
    // ═══════════════════════════════════════════════════
    return(
        <>
            <nav className="navbar">
                <Link to="/" className="flex-none" >
                    <Logo wordmark={false} className="h-8 w-8 md:h-9 md:w-9" />
                </Link>
                <p className="max-md:hidden text-2xl text-black line-clamp-1 w-full font-medium">
                    { title.length ? title : "New Blog" }
                    {isEditingDraft && <span className="editor-draft-badge">Draft</span>}
                </p>

                <div className="flex items-center gap-2 md:gap-4 ml-auto">
                    <PreviewButton />
                    <PublishSteps current={1} />
                    {/* Autosave status — DESKTOP only. Fixed-width right-aligned slot so toggling between
                        "Saving…" and "Saved · Xm ago" never shifts the buttons. On phones there's no room
                        beside the buttons, so it moves to its own line below the nav (see below). */}
                    <span className="hidden md:flex justify-end min-w-[108px]">
                        <SaveStatus status={saveStatus} savedAt={savedAt} />
                    </span>
                    {/* Phase 1 of 3: this doesn't publish — it validates and advances to the publish
                        details form (description, tags, preview), then the scroll-cover step where the
                        actual "Publish" lives. So the label is "Continue", not "Publish". */}
                    <button className="btn-brand py-2 px-4 md:px-6"
                        onClick={handlePublishEvent}
                    >
                        Continue
                    </button>
                    {!isEditingPublishedPost && (
                        // Dual-purpose control: with unsaved work it prompts to save the current draft;
                        // on an empty editor it opens the drafts list. The label/icon track that so the
                        // button reads as a Save action exactly when clicking it will save.
                        <button className="btn-light py-2 px-4 md:px-6 flex items-center gap-2"
                            onClick={handleDraftsClick}
                        >
                            <Icon name={hasContent ? "save" : "draft"} className="text-lg" />
                            {hasContent ? "Save draft" : "Drafts"}
                        </button>
                    )}
                </div>
            </nav>


            {/* Save/Update popup */}
            {showDraftPopup && (
                <div className="editor-draft-popup-overlay" onClick={() => setShowDraftPopup(null)}>
                    <div className="editor-draft-popup" onClick={(e) => e.stopPropagation()}>
                        <p className="editor-draft-popup__text">
                            {showDraftPopup === "update"
                                ? "Save changes to this draft before viewing drafts?"
                                : "Save your current work as a draft?"
                            }
                        </p>
                        <div className="editor-draft-popup__actions">
                            <button className="editor-draft-popup__btn editor-draft-popup__btn--primary" onClick={saveDraftAndGoToList}>
                                {showDraftPopup === "update" ? "Save & view drafts" : "Save as draft"}
                            </button>
                            <button className="editor-draft-popup__btn editor-draft-popup__btn--secondary" onClick={skipAndGoToList}>
                                Don't save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AnimationWrapper>
                <section>
                    <div className="mx-auto max-w-[783px] w-full">
                        <div className="relative aspect-[2/1] md:aspect-video hover:opacity-80 bg-surface border-2 border-dashed border-border rounded-radius-lg overflow-hidden cursor-pointer group transition-all hover:border-brand/40">
                            <label htmlFor="uploadbanner" className="cursor-pointer">
                                <img
                                    src={banner || (theme === "light" ? lightBanner : darkBanner)}
                                    className="z-20"
                                    onError={handleImgError}
                                    />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10">
                                    <div className="bg-surface/90 backdrop-blur-sm rounded-full py-2 px-5 flex items-center gap-2 shadow-md">
                                        <Icon name="add_photo_alternate" className="text-xl text-dark-grey" />
                                        <span className="text-sm font-medium">{banner ? "Change Cover" : "Add Cover"}</span>
                                    </div>
                                </div>
                                <input
                                    id="uploadbanner"
                                    type="file"
                                    accept=".png, .jpg, .jpeg"
                                    hidden
                                    onChange={handleBanner}
                                />
                            </label>

                            {/* Remove the uploaded cover (reverts to the default placeholder). Rendered as a
                                sibling of the upload <label>, so clicking it never opens the file picker. */}
                            {banner ? (
                                <button
                                    type="button"
                                    onClick={handleRemoveBanner}
                                    className="absolute top-3 right-3 z-30 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm shadow-md transition-colors"
                                    title="Remove cover"
                                    aria-label="Remove cover image"
                                >
                                    <Icon name="close" className="text-lg" />
                                </button>
                            ) : null}
                        </div>

                        <textarea
                            rows={1}
                            defaultValue={title}
                            placeholder="Blog Title"
                            className="text-4xl md:text-5xl font-extrabold font-inter tracking-tight w-full outline-none resize-none mt-6 md:mt-10 leading-tight md:leading-[1.1] placeholder:opacity-30 bg-transparent border-none focus:ring-0 focus:outline-none overflow-hidden p-0"
                            style={{ minHeight: '52px' }}
                            onKeyDown={handleTitleKeyDown}
                            onChange={handleTitleChange}
                            ref={(el) => {
                                titleRef.current = el;
                                if (el) {
                                    el.style.height = 'auto';
                                    el.style.height = el.scrollHeight + 'px';
                                }
                            }}
                        ></textarea>

                        <hr className="w-full opacity-10 my-5" />

                        <TiptapEditor
                            content={getInitialContent()}
                            onUpdate={handleEditorUpdate}
                            onEditorReady={handleEditorReady}
                            saveStatus={saveStatus}
                            savedAt={savedAt}
                        />

                    </div>
                </section>
            </AnimationWrapper>

            {bannerToCrop && (
                <ImageCropperModal
                    imageSrc={bannerToCrop}
                    aspect={ARTICLE_BANNER_ASPECT}
                    cropShape="rect"
                    title="Crop cover"
                    onComplete={handleBannerCropped}
                    onCancel={() => setBannerToCrop(null)}
                />
            )}
        </>
    )
}

export default BlogEditor;
