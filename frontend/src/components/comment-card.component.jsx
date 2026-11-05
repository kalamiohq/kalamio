import { useContext, useState, useRef, useEffect } from "react";
import { getDay, getRelativeTime } from "../common/date";
import { UserContext } from "../App";
import toast from "react-hot-toast";
import { BlogContext } from "../pages/blog.page";
import api from "../common/api";
import Icon from "./Icon";
import Avatar from "./Avatar";
import ConfirmModal from "./confirm-modal.component";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../common/queryKeys";

const CommentCard = (props) => {
    // Guard before mounting the stateful card so its hooks always run in order.
    if (!props.commentData.commented_by) {
        return null;
    }

    return <CommentCardContent {...props} />;
}

const CommentCardContent = ({ index, commentData, isTextPost = false, onReplyDeleted }) => {
    let { commented_by: { _id: commented_by_id, personal_info: { profile_img, fullname, username: commented_by_username } }, commentedAt, comment, images, poll, _id, children } = commentData

    let { blog, blog: { comments, activity, activity: { total_parent_comments }, comments: { results: commentsArr }, author: { personal_info: { username: blog_author } } }, setBlog, setTotalParentCommentsLoaded } = useContext(BlogContext)

    let { userAuth: { access_token, username, profile_img: my_profile_img, fullname: my_fullname } } = useContext(UserContext)
    const [ isReplying, setReplying ] = useState(false);
    const [ replyText, setReplyText ] = useState("");
    const [ showDeleteConfirm, setShowDeleteConfirm ] = useState(false);
    const [ isDeleting, setIsDeleting ] = useState(false);
    const [ showDiscardConfirm, setShowDiscardConfirm ] = useState(false);
    const replyTextareaRef = useRef(null);
    const replyModalRef = useRef(null);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // ── Like state ──
    const [ isLiked, setIsLiked ] = useState(false);
    const [ likesCount, setLikesCount ] = useState(commentData.activity?.total_likes || 0);

    // ── Three-dot menu state ──
    const [ showMenu, setShowMenu ] = useState(false);
    const [ isFollowingUser, setIsFollowingUser ] = useState(false);
    const [ followChecked, setFollowChecked ] = useState(false);
    const menuRef = useRef(null);

    // Close menu on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
            }
        };
        if (showMenu) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showMenu]);

    // Check follow status when menu opens (only for non-owners)
    useEffect(() => {
        if (showMenu && !isOwner && access_token && !followChecked && commented_by_id) {
            api.post("/is-following", { user_id: commented_by_id })
            .then(({ data }) => {
                setIsFollowingUser(data.following || false);
                setFollowChecked(true);
            })
            .catch(() => {});
        }
    }, [showMenu]);

    // Check if user has liked this comment
    useEffect(() => {
        if (access_token && _id) {
            api.post("/is-comment-liked", { _id })
            .then(({ data: { result } }) => setIsLiked(!!result))
            .catch(() => {});
        }
    }, [_id, access_token]);

    // ── Preview replies state (text-post mode only) ──
    const [ previewReplies, setPreviewReplies ] = useState([]);
    const [ replyCount, setReplyCount ] = useState(children ? children.length : 0);
    const [ previewLoaded, setPreviewLoaded ] = useState(false);

    // ── Inline replies state (Article mode) ──
    const [ inlineReplies, setInlineReplies ] = useState([]);
    const [ inlineRepliesLoaded, setInlineRepliesLoaded ] = useState(0);
    const [ showInlineReplies, setShowInlineReplies ] = useState(false);
    const [ loadingInlineReplies, setLoadingInlineReplies ] = useState(false);

    // Fetch preview replies (text-post only)
    useEffect(() => {
        if (isTextPost && children && children.length > 0 && !previewLoaded) {
            api.post("/get-preview-replies", { comment_id: _id })
            .then(({ data }) => {
                setPreviewReplies(data.replies || []);
                setReplyCount(data.reply_count || children.length);
                setPreviewLoaded(true);
            })
            .catch(() => {});
        }
        // For articles, just sync replyCount from children
        if (!isTextPost && children) {
            setReplyCount(children.length);
        }
    }, [_id, children?.length]);

    const isOwner = username === commented_by_username || username === blog_author;

    // ── Delete comment ──
    // Deletion is irreversible and cascades to every nested reply, so every entry point
    // routes through the confirm dialog below instead of firing the request directly.
    const requestDeleteComment = () => {
        setShowMenu(false);
        setShowDeleteConfirm(true);
    }

    const deletComment = () => {
        if (isDeleting) return;
        setIsDeleting(true);
        api.post("/delete-comment", { _id })
        .then(() => {
            const isParent = commentData.childrenLevel == 0;
            // Server deletes this comment AND all its nested replies.
            const removedCount = 1 + (commentData.children?.length || 0);

            if (isParent) {
                // Top-level comment: drop it from the blog's comment list. Match by _id, not by
                // `index` — index-based filtering removed the wrong slot and made siblings vanish.
                const newArr = commentsArr.filter(c => c._id !== _id);
                setTotalParentCommentsLoaded(preVal => preVal - 1);
                setBlog({
                    ...blog,
                    comments: { ...comments, results: newArr },
                    activity: {
                        ...activity,
                        total_parent_comments: total_parent_comments - 1,
                        total_comments: (activity.total_comments || 0) - removedCount,
                    }
                });
            } else {
                // Reply. It may live in the PARENT card's inline-replies state (article inline replies)
                // or, in the flat-list reply UI, inside commentsArr. Remove by _id from both — filtering
                // commentsArr by this reply's local `index` (its position among sibling replies) would
                // delete an unrelated top-level comment: the whole-comment-disappears bug. onReplyDeleted
                // handles the inline case; the _id filter is a no-op there and correct for the flat case.
                onReplyDeleted?.(_id);
                const newArr = commentsArr.filter(c => c._id !== _id);
                setBlog({
                    ...blog,
                    comments: { ...comments, results: newArr },
                    activity: {
                        ...activity,
                        total_comments: (activity.total_comments || 0) - removedCount,
                    }
                });
            }

            // Invalidate feed queries so other tabs/views get updated count
            queryClient.invalidateQueries({ queryKey: queryKeys.blogs.all() });

            setShowDeleteConfirm(false);
            setIsDeleting(false);
            toast.success(commentData.childrenLevel == 0 ? "Comment deleted" : "Reply deleted");
        })
        .catch(() => {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
            toast.error("Couldn't delete. Please try again.");
        })
    }

    // ── Copy link ──
    const copyCommentLink = () => {
        setShowMenu(false);
        const link = `${window.location.origin}/comment/${_id}`;
        navigator.clipboard.writeText(link)
            .then(() => toast.success("Link copied"))
            .catch(() => toast.error("Failed to copy link"));
    }

    // ── Follow / Unfollow user ──
    const toggleFollow = () => {
        setShowMenu(false);
        if (!access_token) {
            return toast.error("Login first to follow");
        }
        if (!commented_by_id) return;
        const endpoint = isFollowingUser ? "/unfollow" : "/follow";
        api.post(endpoint, { user_id: commented_by_id })
        .then(() => {
            setIsFollowingUser(!isFollowingUser);
            toast.success(isFollowingUser ? "Unfollowed" : "Following");
        })
        .catch(() => toast.error("Something went wrong"));
    }

    // ── Like / Unlike comment ──
    const handleLike = () => {
        if (!access_token) {
            return toast.error("Login first to like");
        }
        api.post("/like-comment", { _id, isLikedByUser: isLiked })
        .then(({ data }) => {
            setIsLiked(data.liked_by_user);
            setLikesCount(data.total_likes);
        })
        .catch(() => toast.error("Something went wrong"));
    }

    // ── Reply handling ──
    const handleReplyClick = () => {
        if(!access_token){
            return toast.error("login first to leave a reply")
        }
        setReplying(true);
        setReplyText("");
    }

    useEffect(() => {
        if (isReplying && replyTextareaRef.current) {
            replyTextareaRef.current.focus();
        }
    }, [isReplying]);

    // Closing the reply modal must not silently destroy typed text — confirm first.
    const closeReplyModal = () => {
        setShowDiscardConfirm(false);
        setReplying(false);
        setReplyText("");
    }

    const requestCloseReplyModal = () => {
        if (replyText.trim().length) {
            return setShowDiscardConfirm(true);
        }
        closeReplyModal();
    }

    // Escape closes the reply modal (through the same discard guard).
    useEffect(() => {
        if (!isReplying) return;
        const handleKey = (e) => {
            // While the discard confirmation is up it owns Escape.
            if (e.key === "Escape" && !showDiscardConfirm) {
                e.stopPropagation();
                requestCloseReplyModal();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [isReplying, showDiscardConfirm, replyText]);

    // Keep Tab focus inside the reply dialog instead of letting it walk the page behind.
    const handleReplyModalKeyDown = (e) => {
        if (e.key !== "Tab" || !replyModalRef.current) return;
        const focusable = replyModalRef.current.querySelectorAll(
            'button:not([disabled]), textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    const handleReplySubmit = () => {
        if (!replyText.trim().length) return;

        api.post("/add-comment", {
            _id: blog._id, blog_author: blog.author._id, comment: replyText, replying_to: _id
        })
        .then(({ data }) => {
            setReplyText("");
            setReplying(false);

            data.commented_by = { personal_info: { username, profile_img: my_profile_img, fullname: my_fullname } }

            setReplyCount(prev => prev + 1);

            if (isTextPost) {
                setPreviewReplies([data]);
                setPreviewLoaded(true);
            } else {
                // Article: add to inline replies if expanded
                setInlineReplies(prev => [data, ...prev]);
                setInlineRepliesLoaded(prev => prev + 1);
                setShowInlineReplies(true);
            }

            if (!commentData.children) commentData.children = [];
            commentData.children.push(data._id);

            setBlog({ ...blog, 
                comments: { ...comments, results: commentsArr },
                activity: { ...activity, total_comments: (activity.total_comments || 0) + 1 }
            });
        })
        .catch(() => {});
    }

    // ── Navigate to comment thread page (text-post only) ──
    const handleCommentClick = () => {
        navigate(`/comment/${_id}`);
    }

    // ── Inline reply expansion (Article only) ──
    const loadInlineReplies = () => {
        setLoadingInlineReplies(true);
        api.post("/get-replies", { _id, skip: inlineRepliesLoaded })
        .then(({ data }) => {
            const newReplies = (data.replies || []);
            setInlineReplies(prev => {
                const existingIds = new Set(prev.map(r => r._id));
                const deduped = newReplies.filter(r => !existingIds.has(r._id));
                return [...prev, ...deduped];
            });
            setInlineRepliesLoaded(prev => prev + (newReplies.length || 0));
            setShowInlineReplies(true);
            setLoadingInlineReplies(false);
        })
        .catch(() => setLoadingInlineReplies(false));
    }

    const toggleInlineReplies = () => {
        if (showInlineReplies) {
            setShowInlineReplies(false);
        } else if (inlineReplies.length > 0) {
            setShowInlineReplies(true);
        } else {
            loadInlineReplies();
        }
    }

    // ── Render @mentions ──
    const renderText = (text) => {
        if (!text) return null;
        const parts = text.split(/(@[\w](?:[\w.]*[\w])?)/g);
        return parts.map((part, i) => {
            if (part.startsWith('@') && part.length > 1) {
                const usernameRef = part.slice(1);
                return (
                    <Link key={i} to={`/user/${usernameRef}`} className="mention-link">
                        {part}
                    </Link>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    // ── Reply Preview sub-component (for text-post inline replies) ──
    const ReplyPreview = ({ reply }) => {
        if (!reply) return null;
        
        // Fallback for missing commented_by
        const rImg = reply.commented_by?.personal_info?.profile_img || "";
        const rName = reply.commented_by?.personal_info?.fullname || "Unknown User";
        const rUsername = reply.commented_by?.personal_info?.username || "";
        
        return (
            <div className="reply-preview" onClick={() => navigate(`/comment/${reply._id || _id}`)} style={{ cursor: 'pointer' }}>
                <div className="reply-preview__body">
                    <Link to={`/user/${rUsername}`} className="reply-preview__avatar" onClick={e => e.stopPropagation()}>
                        <Avatar src={rImg} alt={rUsername} size={28} />
                    </Link>
                    <div className="reply-preview__content">
                        <div className="reply-preview__meta">
                            <Link to={`/user/${rUsername}`} className="reply-preview__name" onClick={e => e.stopPropagation()}>{rName}</Link>
                            <span className="comment-card__dot">·</span>
                            <span className="reply-preview__time">{getRelativeTime(reply.commentedAt)}</span>
                        </div>
                        <p className="reply-preview__text">{renderText(reply.comment)}</p>
                        <div className="reply-preview__actions">
                            <button className="comment-card__action-btn">
                                <Icon name="favorite_border" />
                                <span>{reply.likes || 0}</span>
                            </button>
                            <button className="comment-card__action-btn">
                                <Icon name="chat_bubble_outline" />
                                <span>{reply.children?.length || ""}</span>
                            </button>
                            {isTextPost && (
                                <button className="comment-card__action-btn" aria-label="Reshare reply">
                                    <Icon name="repeat" />
                                </button>
                            )}
                            <button className="comment-card__action-btn" aria-label="Share reply">
                                <Icon name="upload" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const hasPreview = previewLoaded && previewReplies.length > 0;

    // ── Three-dot menu component ──
    const ThreeDotMenu = () => (
        <div className="comment-card__menu-wrapper" ref={menuRef}>
            <button 
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className="comment-card__delete"
                aria-label="More comment actions"
            >
                <Icon name="more_horiz" className="text-lg" />
            </button>
            {showMenu && (
                <div className="comment-card__dropdown">
                    <button className="comment-card__dropdown-item" onClick={copyCommentLink}>
                        <Icon name="link" />
                        <span>Copy link</span>
                    </button>
                    {isOwner ? (
                        <button className="comment-card__dropdown-item comment-card__dropdown-item--danger" onClick={requestDeleteComment}>
                            <Icon name="delete" />
                            <span>Delete</span>
                        </button>
                    ) : (
                        <button className="comment-card__dropdown-item" onClick={toggleFollow}>
                            <Icon name={isFollowingUser ? "person_remove" : "person_add"} />
                            <span>{isFollowingUser ? "Following" : "Follow"}</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className="comment-card">
            <div className={`comment-card__body ${hasPreview ? 'comment-card__body--threaded' : ''}`}>
                <div className="comment-card__avatar-col">
                    <Link to={`/user/${commented_by_username}`} className="comment-card__avatar">
                        <Avatar src={profile_img} alt={commented_by_username} size={32} />
                    </Link>
                    {hasPreview && <div className="comment-card__thread-line"></div>}
                </div>
                <div className="comment-card__content">
                    <div className="comment-card__meta">
                        <Link to={`/user/${commented_by_username}`} className="comment-card__name">{fullname}</Link>
                        <span className="comment-card__dot">·</span>
                        <span className="comment-card__time">{getRelativeTime(commentedAt)}</span>
                        <ThreeDotMenu />
                    </div>

                    {/* Comment text — clickable to go to thread (text-post only) */}
                    {isTextPost ? (
                        <div 
                            className="comment-card__text-clickable"
                            onClick={handleCommentClick}
                        >
                            <p className="comment-card__text">{renderText(comment)}</p>
                        </div>
                    ) : (
                        <p className="comment-card__text">{renderText(comment)}</p>
                    )}

                    {/* Images */}
                    {images && images.length > 0 && (
                        <div className={`feed-card__text-post-images feed-card__text-post-images--${Math.min(images.length, 4)} comment-card__media`}>
                            {images.map((url, i) => (
                                <img key={i} src={url} alt={`Image ${i + 1}`} className="feed-card__text-post-image" />
                            ))}
                        </div>
                    )}

                    {/* Poll */}
                    {poll && poll.options && poll.options.length > 0 && (
                        <div className="feed-card__text-post-poll comment-card__media">
                            {poll.question && (
                                <div className="feed-card__text-post-poll-header">
                                    <Icon name="poll" className="feed-card__text-post-poll-icon" />
                                    <span className="feed-card__text-post-poll-question">{poll.question}</span>
                                </div>
                            )}
                            <div className="feed-card__text-post-poll-options">
                                {poll.options.map((opt, i) => (
                                    <div key={i} className="feed-card__text-post-poll-option">
                                        <div className="feed-card__text-post-poll-label">
                                            <span className="feed-card__text-post-poll-text">{opt.text}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="feed-card__text-post-poll-footer">
                                <Icon name="people_outline" className="text-sm" />
                                <span>{poll.total_votes || 0} vote{(poll.total_votes || 0) !== 1 ? 's' : ''}</span>
                            </div>
                        </div>
                    )}

                    {/* Action bar */}
                    {isTextPost ? (
                        /* ── Text-post style actions ── */
                        <div className="comment-card__actions">
                            <button className={`comment-card__action-btn ${isLiked ? 'comment-card__action-btn--liked' : ''}`} onClick={handleLike}>
                                <Icon name={isLiked ? "favorite" : "favorite_border"} filled={isLiked} />
                                <span>{likesCount}</span>
                            </button>

                            <button className="comment-card__action-btn" onClick={handleReplyClick}>
                                <Icon name="chat_bubble_outline" />
                                <span>{replyCount}</span>
                            </button>

                            <button className="comment-card__action-btn">
                                <Icon name="repeat" />
                                <span>{commentData.reshares || ""}</span>
                            </button>

                            <button className="comment-card__action-btn" aria-label="Share comment">
                                <Icon name="upload" />
                            </button>
                        </div>
                    ) : (
                        /* ── Article actions ── */
                        <>
                            <div className="comment-card__actions comment-card__actions--yt">
                                <button className={`comment-card__action-btn ${isLiked ? 'comment-card__action-btn--liked' : ''}`} onClick={handleLike}>
                                    <Icon name={isLiked ? "favorite" : "favorite_border"} filled={isLiked} />
                                    <span>{likesCount}</span>
                                </button>

                                <button className="comment-card__reply-text-btn" onClick={handleReplyClick}>
                                    Reply
                                </button>
                            </div>

                            {replyCount > 0 && (
                                <button className={`comment-card__replies-toggle ${showInlineReplies ? 'comment-card__replies-toggle--open' : ''}`} onClick={toggleInlineReplies} disabled={loadingInlineReplies}>
                                    <Icon name={showInlineReplies ? "expand_less" : "expand_more"} />
                                    <span>{loadingInlineReplies ? 'Loading...' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}</span>
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Inline expanded replies (Article only) */}
            {!isTextPost && showInlineReplies && inlineReplies.length > 0 && (
                <div className="comment-card__inline-replies">
                    {inlineReplies.map((reply, i) => (
                        <CommentCard
                            key={reply._id || i}
                            index={i}
                            commentData={{...reply, childrenLevel: (commentData.childrenLevel || 0) + 1}}
                            isTextPost={false}
                            onReplyDeleted={(rid) => {
                                setInlineReplies(prev => prev.filter(r => r._id !== rid));
                                setReplyCount(c => Math.max(0, c - 1));
                                setInlineRepliesLoaded(n => Math.max(0, n - 1));
                            }}
                        />
                    ))}
                    {inlineRepliesLoaded < replyCount && (
                        <button className="comment-card__replies-toggle" onClick={loadInlineReplies} disabled={loadingInlineReplies}>
                            <Icon name="expand_more" />
                            <span>{loadingInlineReplies ? 'Loading...' : 'Show more replies'}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Inline Preview Replies (text-post only) */}
            {isTextPost && hasPreview && (
                <div className="comment-card__preview-replies">
                    {previewReplies.map((reply, i) => (
                        <ReplyPreview key={reply._id || i} reply={reply} />
                    ))}
                    {replyCount > previewReplies.length && (
                        <button className="comment-card__replies-toggle mt-4 ml-11" onClick={handleCommentClick}>
                            <Icon name="expand_more" />
                            <span>Show {replyCount - previewReplies.length} more repl{replyCount - previewReplies.length === 1 ? 'y' : 'ies'}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Reply Modal */}
            {isReplying && (
                <div className="comment-modal-overlay" onClick={requestCloseReplyModal}>
                    <div
                        className="reply-modal"
                        ref={replyModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Leave a reply"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={handleReplyModalKeyDown}
                    >
                        {/* Parent comment context */}
                        <div className="reply-modal__row">
                            <div className="reply-modal__left">
                                <Avatar src={profile_img} alt={commented_by_username} size={36} />
                                <div className="reply-modal__line"></div>
                            </div>
                            <div className="reply-modal__right">
                                <div className="reply-modal__header">
                                    <span className="reply-modal__name">{fullname}</span>
                                    <span className="reply-modal__time">{getRelativeTime(commentedAt)}</span>
                                </div>
                                <div className="reply-modal__text">{comment}</div>
                            </div>
                        </div>

                        {/* Current user reply */}
                        <div className="reply-modal__row" style={{ marginTop: '-4px' }}>
                            <div className="reply-modal__left">
                                <Avatar src={my_profile_img} alt={my_fullname} size={36} />
                            </div>
                            <div className="reply-modal__right">
                                <div className="reply-modal__name mb-1">{my_fullname}</div>
                                <textarea
                                    ref={replyTextareaRef}
                                    className="reply-modal__textarea"
                                    placeholder="Leave a reply..."
                                    value={replyText}
                                    onChange={(e) => {
                                        setReplyText(e.target.value);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && replyText.trim().length > 0) {
                                            e.preventDefault();
                                            handleReplySubmit();
                                        }
                                    }}
                                    rows={1}
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="reply-modal__footer">
                            <div></div>
                            <div className="reply-modal__actions">
                                <button className="reply-modal__cancel-btn" onClick={requestCloseReplyModal}>
                                    Cancel
                                </button>
                                <button 
                                    className="reply-modal__post-btn"
                                    onClick={handleReplySubmit}
                                    disabled={!replyText.trim().length}
                                >
                                    Reply
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteConfirm}
                variant="danger"
                title={commentData.childrenLevel == 0 ? "Delete this comment?" : "Delete this reply?"}
                message={`This can't be undone.${replyCount > 0 ? ` Its ${replyCount} ${replyCount === 1 ? "reply" : "replies"} will also be deleted.` : ""}`}
                confirmLabel={isDeleting ? "Deleting..." : "Delete"}
                onConfirm={deletComment}
                onCancel={() => { if (!isDeleting) setShowDeleteConfirm(false); }}
            />

            <ConfirmModal
                isOpen={showDiscardConfirm}
                variant="danger"
                title="Discard this reply?"
                message="Your typed reply will be lost."
                confirmLabel="Discard"
                cancelLabel="Keep editing"
                onConfirm={closeReplyModal}
                onCancel={() => setShowDiscardConfirm(false)}
            />
        </div>
    )
}

export default CommentCard;
