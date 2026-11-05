import { useSeo, buildArticleJsonLd, PRODUCTION_ORIGIN } from "../common/useSeo";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate, useLocation, useOutletContext } from "react-router-dom";
import AnimationWrapper from "../common/page-animation";
import ArticleSkeleton from "../components/article-skeleton.component";
import { getDay, getRelativeTime } from "../common/date";
import { estimateReadTime } from "../common/read-time";
import BlogInteraction from "../components/blog-interaction.component";
import BlogPostCard from "../components/blog-post.component";
import BlogContent from "../components/blog-content.component";
import ReadingProgress from "../components/reading-progress.component";
import CommentsContainer, { fetchComments } from "../components/comments.component";
import { saveReadingProgress } from "../components/keep-reading.component";
import { cdnUrl } from "../common/cdn";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import FollowButton from "../components/follow-button.component";
import SubscribeButton from "../components/subscribe-button.component";
import RightSidebar from "../components/right-sidebar.component";
import { UserContext } from "../App";
import toast from "react-hot-toast";
import NetworkError from "../components/network-error.component";
import useReadTracker from "../hooks/useReadTracker";
import { useBlogDetail, useBlogActivity, useSimilarBlogs, usePollVoteStatus } from "../hooks/queries";
import { useVotePoll } from "../hooks/mutations";
import PollVotersModal from "../components/poll-voters-modal.component";

// Inline poll component for the blog page detail view
const TextPostPollView = ({ poll: initialPoll, blogId, isCreator }) => {
    const { userAuth: { access_token } } = useContext(UserContext);
    const [showVotersModal, setShowVotersModal] = useState(false);
    const { data: voteStatus } = usePollVoteStatus(blogId);
    const voteMutation = useVotePoll();
    const [poll, setPoll] = useState(initialPoll);

    const hasVoted = voteStatus?.hasVoted || false;
    const selectedOption = voteStatus?.option_index ?? null;

    // Sync poll data when initial data changes
    useEffect(() => {
        setPoll(initialPoll);
    }, [initialPoll]);

    const handleVote = (optionIndex) => {
        if (hasVoted || !access_token) {
            if (!access_token) toast.error("Please login to vote");
            return;
        }

        // Optimistic local update for poll counts
        setPoll(prev => {
            const updated = { ...prev };
            updated.options = prev.options.map((opt, i) => ({
                ...opt,
                votes: i === optionIndex ? opt.votes + 1 : opt.votes
            }));
            updated.total_votes = (prev.total_votes || 0) + 1;
            return updated;
        });

        voteMutation.mutate({ blogId, optionIndex }, {
            onSuccess: (data) => {
                if (data?.data?.poll) setPoll(data.data.poll);
            },
            onError: () => {
                toast.error("Vote failed");
                setPoll(initialPoll);
            }
        });
    };

    return (
        <div className="feed-card__text-post-poll mb-6">
            {poll.question && (
                <div className="feed-card__text-post-poll-header">
                    <Icon name="poll" className="feed-card__text-post-poll-icon" />
                    <span className="feed-card__text-post-poll-question">{poll.question}</span>
                </div>
            )}
            <div className="feed-card__text-post-poll-options">
                {poll.options.map((opt, i) => {
                    const totalVotes = poll.total_votes || 0;
                    const percent = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                    return (
                        <div key={i}
                            className={`feed-card__text-post-poll-option ${hasVoted ? 'feed-card__text-post-poll-option--voted' : ''} ${selectedOption === i ? 'feed-card__text-post-poll-option--selected' : ''}`}
                            onClick={() => !hasVoted && handleVote(i)}
                        >
                            {hasVoted && <div className="feed-card__text-post-poll-bar" style={{ width: `${percent}%` }} />}
                            <div className="feed-card__text-post-poll-label">
                                <span className="feed-card__text-post-poll-text">
                                    {!hasVoted && (
                                        <span className="feed-card__text-post-poll-radio" />
                                    )}
                                    {hasVoted && selectedOption === i && (
                                        <Icon name="check_circle" className="feed-card__text-post-poll-check" />
                                    )}
                                    {opt.text}
                                </span>
                                {hasVoted && <span className="feed-card__text-post-poll-percent">{percent}%</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="feed-card__text-post-poll-footer">
                <span>{poll.total_votes || 0} vote{(poll.total_votes || 0) !== 1 ? 's' : ''}</span>
                {isCreator && (poll.total_votes || 0) > 0 && (
                    <button
                        className="poll-voters-btn"
                        onClick={() => setShowVotersModal(true)}
                    >
                        <Icon name="visibility" className="text-sm" />
                        See voters
                    </button>
                )}
            </div>

            {showVotersModal && (
                <PollVotersModal
                    blogId={blogId}
                    poll={poll}
                    isOpen={showVotersModal}
                    onClose={() => setShowVotersModal(false)}
                />
            )}
        </div>
    );
};


export const blogStructure = {
    title: '',
    des: '',
    content: [],
    tags: [],
    blog_id: '',
    author: { _id: null, personal_info: { }, account_info: { total_posts: 0, total_reads: 0 } },
    banner: '',
    publishedAt: '',
    activity: { total_likes: 0, total_comments: 0, total_reads: 0, total_parent_comments: 0 },
    comments: { results: [] },
}

export const BlogContext = createContext({  })

const BlogPage = () => {

    let { blog_id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { userAuth: { username: loggedInUsername } = {} } = useContext(UserContext);

    // UI-only state (not server data)
    const [ commentsWrapper, setCommentsWrapper ] = useState(false);
    const [ totalParentCommentsLoaded, setTotalParentCommentsLoaded ] = useState(0);
    const articleRef = useRef(null);
    const contentRef = useRef(null);

    // ── Query hooks ─────────────────────────────────────────────
    const blogQuery = useBlogDetail(blog_id);

    // Local blog state: merges query data + comments (which come from a separate fetch)
    const [blogWithComments, setBlogWithComments] = useState(blogStructure);

    // Sync query data into local state when it arrives/changes
    useEffect(() => {
        if (blogQuery.data) {
            setBlogWithComments(prev => ({
                ...blogQuery.data,
                comments: prev.comments || { results: [] },
            }));
        }
    }, [blogQuery.data]);

    const blog = blogWithComments;
    const setBlog = setBlogWithComments;

    // Live like/comment/poll numbers: a signed-in reader's visible tab re-reads them once a minute and
    // they're merged into the post on screen. Not a socket, because a tab left open on an article would
    // keep Cloud Run instances at full price (see common/socket.js). Query data only changes identity
    // when the numbers do, so an unchanged poll can't overwrite a like the reader just made.
    const { data: liveActivity } = useBlogActivity(blogQuery.data?.draft ? null : blogQuery.data?.blog_id);
    useEffect(() => {
        if (!liveActivity) return;
        const { activity, poll } = liveActivity;
        setBlogWithComments(prev => ({
            ...prev,
            ...(poll ? { poll } : {}),
            activity: { ...prev.activity, ...activity },
        }));
    }, [liveActivity]);

    let { title, des, tags, content, banner, author: { personal_info: { fullname, username: author_username, profile_img, bio }, account_info: { total_posts: author_total_posts, total_reads: author_total_reads } = {} }, publishedAt, publication, type, text_content, images, poll: blogPoll } = blog;

    const isTextPost = type === 'text_post';
    const isDraft = blog.draft;
    // Stored read time (computed at publish); fall back to computing it for older/unbackfilled posts.
    const readMinutes = blog.readTime || estimateReadTime(content, title, des);

    // Tell MainLayout which chrome to use: only the ARTICLE read goes sidebar-less (its back button is
    // inline in the title); text posts keep the normal left sidebar / mobile top bar. Stay quiet until
    // the query resolves — MainLayout's route-based seed covers the loading window, and reporting early
    // would misread a not-yet-loaded post as an article.
    const { setFocusedReading } = useOutletContext() ?? {};
    const loadedIsTextPost = blogQuery.data ? isTextPost : null;
    useEffect(() => {
        if (loadedIsTextPost === null) return;
        setFocusedReading?.(!loadedIsTextPost);
    }, [setFocusedReading, loadedIsTextPost]);

    // Similar blogs — only fetches when blog data is loaded and has tags
    const { data: similarBlogs } = useSimilarBlogs(blog_id, tags);

    // ── SEO / social meta ───────────────────────────────────────
    const seoTitle = isTextPost
        ? (text_content ? text_content.substring(0, 60) : 'Text Post')
        : (title || 'Blog');
    const seoDescription = des || (text_content ? text_content.substring(0, 160) : undefined);
    const canonicalUrl = `${PRODUCTION_ORIGIN}/blog/${blog_id}`;

    useSeo({
        title: seoTitle,
        description: seoDescription,
        image: banner || undefined,
        url: canonicalUrl,
        type: 'article',
        noindex: isDraft, // never index unpublished drafts
        jsonLd: (!isDraft && (title || text_content))
            ? buildArticleJsonLd({
                title: seoTitle,
                description: seoDescription,
                image: banner,
                url: canonicalUrl,
                publishedAt,
                authorName: fullname,
                authorUsername: author_username,
            })
            : null,
    });

    // Production-grade read tracking: scroll depth + time spent + deduplication
    useReadTracker({
        blogId: blog_id,
        readTime: blog.readTime || 1,
        authorId: blog.author?._id,
        isDraft: blog.draft,
        isEditMode: false,
    });

    // Load comments on initial load + refetch on tab visibility change (cross-tab sync)
    useEffect(() => {
        const fetchAndSetComments = () => {
            if (blogQuery.data && !blogQuery.data.draft && blogQuery.data._id) {
                fetchComments({ blog_id: blogQuery.data._id, setParentCommentCountFun: setTotalParentCommentsLoaded })
                    .then(res => {
                        if (!res) return;
                        setBlogWithComments(prev => {
                            // Apply the server-synced counts so a stale total (e.g. the "1 comment but
                            // none exist" drift) self-corrects on load.
                            const activity = {
                                ...prev.activity,
                                ...(res.total_comments != null ? { total_comments: res.total_comments } : {}),
                                ...(res.total_parent_comments != null ? { total_parent_comments: res.total_parent_comments } : {}),
                            };
                            const existing = prev.comments?.results || [];
                            // First load — take the fresh first page as-is.
                            if (!existing.length) {
                                return { ...prev, comments: { results: res.results }, activity };
                            }
                            // Tab-focus refetch: keep every page already loaded and just prepend any
                            // brand-new top-level comments, so loaded pages survive the tab switch.
                            const existingIds = new Set(existing.map(c => c._id));
                            const brandNew = res.results.filter(c => !existingIds.has(c._id));
                            return { ...prev, comments: { results: [...brandNew, ...existing] }, activity };
                        });
                    })
                    .catch(() => {});
            }
        };

        fetchAndSetComments();

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchAndSetComments();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [blogQuery.data?._id]);

    // Save for Keep Reading widget when blog loads
    useEffect(() => {
        if (blogQuery.data && !blogQuery.data.draft) {
            saveReadingProgress(blogQuery.data);
        }
    }, [blogQuery.data?._id]);

    // Reset comment UI on blog_id change. Window scroll is owned by <ScrollToTop />, which
    // tops-out a fresh article and restores on Back — calling scrollTo here would race and
    // defeat that restore (it runs post-paint, after the manager's layout-effect restore).
    useEffect(() => {
        setCommentsWrapper(false);
        setTotalParentCommentsLoaded(0);

        if (location.state?.openComments) {
            setCommentsWrapper(true);
        }
    }, [blog_id]);

    // Render text with line breaks and mentions preserved
    const renderText = (text) => {
        if (!text) return null;
        
        const parts = text.split(/(@[\w](?:[\w.]*[\w])?)/g);
        
        return parts.map((part, i) => {
            if (part.startsWith('@') && part.length > 1) {
                const username = part.slice(1);
                return (
                    <Link key={i} to={`/user/${username}`} className="mention-link">
                        {part}
                    </Link>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <AnimationWrapper>
            {
                // Keep the skeleton until the query data has been synced into local state. Otherwise the
                // render right after isLoading flips false — but before the sync effect runs — shows the
                // empty blogStructure (type undefined → the Article layout with "NaN undefined"), which
                // then swaps to the real text-post layout: a large flash/jump on open.
                (blogQuery.isLoading || (blogQuery.data && blog._id !== blogQuery.data._id)) ? <ArticleSkeleton variant={blog_id?.startsWith('tp-') ? 'text' : 'article'} />
                : blogQuery.isError ? <NetworkError onRetry={() => blogQuery.refetch()} />
                :
                <BlogContext.Provider value={{ blog, setBlog, isLikedByUser: false, setLikedByUser: () => {}, commentsWrapper, setCommentsWrapper, totalParentCommentsLoaded, setTotalParentCommentsLoaded }}>
                    <div className={isTextPost ? "home-layout" : ""}>
                        <div className={isTextPost ? "home-feed max-lg:pt-0 lg:pt-10" : ""}>
                            <div className={`max-w-[900px] w-full center max-lg:px-[5vw] ${isTextPost ? 'max-lg:pt-0 max-lg:pb-6 lg:py-10' : 'max-lg:pt-0 max-lg:pb-10 lg:py-10'}`}>

                        {isDraft && (
                            <div className="draft-preview-banner">
                                <Icon name="visibility_off" className="text-lg" />
                                <span>Draft Preview — This is only visible to you</span>
                                {!isTextPost && (
                                    <Link to={`/editor/${blog_id}`} className="draft-preview-banner__edit">
                                        <Icon name="edit" className="text-base" />
                                        Edit Draft
                                    </Link>
                                )}
                            </div>
                        )}

                        {isTextPost ? (
                            /* ── Text Post View ── */
                            <div>
                                <div className="flex items-center gap-4 mb-6 lg:hidden">
                                    <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full hover:bg-grey flex items-center justify-center transition-colors -ml-2">
                                        <Icon name="arrow_back" className="text-xl" />
                                    </button>
                                    <h1 className="font-semibold text-xl">Post</h1>
                                </div>
                                <div className="flex gap-5 items-start mb-6">
                                    <Avatar src={profile_img} alt={fullname} size={48} />
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <p className="capitalize font-semibold">{fullname}</p>
                                            {!isDraft && blog.author._id && (
                                                <FollowButton targetUserId={blog.author._id} size="sm" />
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-dark-grey text-sm">
                                            <Link to={`/user/${author_username}`} className="hover:text-black transition-colors">@{author_username}</Link>
                                            <span>·</span>
                                            <span>{isDraft ? "Draft" : getDay(publishedAt)}</span>
                                            {publication && (
                                                <>
                                                    <span>·</span>
                                                    <span>in</span>
                                                    <Link to={`/publication/${publication.slug}`} className="text-black hover:underline transition-colors font-medium">
                                                        {publication.title}
                                                    </Link>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="text-lg leading-relaxed whitespace-pre-wrap mb-6" style={{ lineHeight: '1.8' }}>
                                    {renderText(text_content)}
                                </div>

                                {images && images.length > 0 && (
                                    <div className={`feed-card__text-post-images feed-card__text-post-images--${Math.min(images.length, 4)} mb-6`}>
                                        {images.map((url, i) => (
                                            <img key={i} src={cdnUrl(url)} alt={`Image ${i + 1}`} className="feed-card__text-post-image" />
                                        ))}
                                    </div>
                                )}

                                {blogPoll && blogPoll.options && blogPoll.options.length > 0 && (
                                    <TextPostPollView poll={blogPoll} blogId={blog_id} isCreator={author_username === loggedInUsername} />
                                )}

                                {!isDraft && <BlogInteraction />}
                            </div>
                        ) : (
                            /* ── Article View (existing) ── */
                            <div ref={articleRef}>
                                <ReadingProgress targetRef={articleRef} contentRef={contentRef} resetKey={blog_id} content={content} />
                                <div className="max-w-[720px] mx-auto mt-4 md:mt-8">
                                    <h1 className="text-4xl md:text-5xl font-extrabold font-inter leading-tight md:leading-[1.1] text-black mb-4 tracking-tight">
                                        {/* Inline + align-middle keeps the icon vertically centered on the title's first
                                            line (symmetric); later lines wrap full-width beneath it. */}
                                        <button
                                            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
                                            className="inline-flex align-middle relative -top-[4px] mr-3 w-10 h-10 rounded-2xl bg-black text-white shadow-sm hover:opacity-80 active:scale-95 items-center justify-center transition-all"
                                            aria-label="Go back"
                                            title="Go back"
                                        >
                                            <Icon name="chevron_left" className="text-2xl" />
                                        </button>
                                        {title}
                                    </h1>

                                    {des && (
                                        <p className="text-xl md:text-2xl text-dark-grey leading-relaxed mb-8 font-inter">
                                            {des}
                                        </p>
                                    )}

                                    {tags && tags.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-8">
                                            {tags.map((tag, i) => (
                                                <span key={i} className="text-xs font-medium px-3 py-1 rounded-full text-dark-grey bg-grey hover:text-black transition-colors cursor-pointer" onClick={() => navigate(`/search/${encodeURIComponent(tag)}`)} role="link" tabIndex={0}>#{tag}</span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4 mb-6">
                                        <Link to={`/user/${author_username}`} className="flex-none">
                                            <Avatar src={profile_img} alt={fullname} size={48} />
                                        </Link>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-3">
                                                <Link to={`/user/${author_username}`} className="font-semibold text-black capitalize hover:underline">
                                                    {fullname}
                                                </Link>
                                                {!isDraft && blog.author._id && (
                                                    <FollowButton targetUserId={blog.author._id} size="sm" />
                                                )}
                                            </div>
                                            <Link to={`/user/${author_username}`} className="text-dark-grey text-sm hover:text-black transition-colors w-fit">
                                                @{author_username}
                                            </Link>
                                            {publication && (
                                                <p className="text-dark-grey text-sm mt-0.5 flex items-center gap-1.5">
                                                    <span>Published in</span>
                                                    <Link to={`/publication/${publication.slug}`} className="text-black hover:underline transition-colors font-medium">
                                                        {publication.title}
                                                    </Link>
                                                </p>
                                            )}
                                        </div>

                                        {/* Published date + read time — pinned to the right of the author row */}
                                        <div className="text-dark-grey text-sm whitespace-nowrap ml-auto self-start flex flex-col items-end gap-0.5">
                                            <span>{isDraft ? "Draft" : getRelativeTime(publishedAt)}</span>
                                            <span>{readMinutes} min read</span>
                                        </div>
                                    </div>

                                    {!isDraft && (
                                        <div className="mb-8">
                                            <BlogInteraction />
                                        </div>
                                    )}
                                </div>

                                {banner && (
                                    <div className="my-8 md:my-12 max-sm:-ml-[5vw] max-sm:w-screen">
                                        <img 
                                            src={cdnUrl(banner)}
                                            className="w-full aspect-video md:aspect-[2/1] object-cover sm:rounded-2xl shadow-xl shadow-black/5" 
                                            alt={title} 
                                        />
                                    </div>
                                )}

                                <div className="max-w-[720px] mx-auto">
                                    <div ref={contentRef} className="my-8 font-merriweather blog-page-content" style={{ lineHeight: '1.9' }}>
                                        <BlogContent content={content} />
                                    </div>

                                    {!isDraft && <BlogInteraction />}
                                </div>
                            </div>
                        )}

                        {!isDraft && <CommentsContainer />}
                    </div>

                    {/* ── Footer Section (CTAs & Similar Blogs) ── */}
                    {!isDraft && (
                    <div className="border-t border-border py-10 mt-10 sm:mt-16">
                        <div className="max-w-[900px] center max-lg:px-[5vw]">
                            {/* ── CTA Section ── */}
                            <div className="blog-cta-section !mt-0">

                            {/* Author CTA */}
                            <div className="blog-cta-card">
                                <div className="blog-cta-card__header">
                                    <span className="blog-cta-card__label">Written by</span>
                                </div>
                                <div className="blog-cta-card__body">
                                    <Link to={`/user/${author_username}`} className="blog-cta-card__avatar-link">
                                        <Avatar src={profile_img} alt={fullname} size={56} />
                                    </Link>
                                    <div className="blog-cta-card__info">
                                        <Link to={`/user/${author_username}`} className="blog-cta-card__name">{fullname}</Link>
                                        <p className="blog-cta-card__username">@{author_username}</p>
                                        {bio && <p className="blog-cta-card__bio">{bio}</p>}
                                        <div className="blog-cta-card__stats">
                                            <span><Icon name="article" className="text-sm" /> {author_total_posts || 0} posts</span>
                                            <span><Icon name="visibility" className="text-sm" /> {(author_total_reads || 0).toLocaleString()} reads</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="blog-cta-card__actions">
                                    <Link to={`/user/${author_username}`} className="blog-cta-card__btn">View Profile</Link>
                                    {blog.author?._id && <FollowButton targetUserId={blog.author._id} size="sm" />}
                                </div>
                            </div>

                            {/* Publication CTA */}
                            {publication && (
                                <div className="blog-cta-card blog-cta-card--pub">
                                    <div className="blog-cta-card__header">
                                        <span className="blog-cta-card__label">
                                            <Icon name="import_contacts" className="text-sm" /> Published in
                                        </span>
                                    </div>
                                    <div className="blog-cta-card__body">
                                        <div className="blog-cta-card__pub-icon-wrap">
                                            {publication.profile_photo ? (
                                                <img src={cdnUrl(publication.profile_photo)} alt={publication.title} className="w-full h-full object-cover" />
                                            ) : (
                                                <Icon name="menu_book" className="blog-cta-card__pub-icon" />
                                            )}
                                        </div>
                                        <div className="blog-cta-card__info">
                                            <Link to={`/publication/${publication.slug}`} className="blog-cta-card__name">{publication.title}</Link>
                                            {publication.description && <p className="blog-cta-card__bio">{publication.description}</p>}
                                            <div className="blog-cta-card__stats">
                                                <span><Icon name="group" className="text-sm" /> {publication.total_subscribers || 0} subscribers</span>
                                                <span><Icon name="article" className="text-sm" /> {publication.total_posts || 0} posts</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="blog-cta-card__actions">
                                        <Link to={`/publication/${publication.slug}`} className="blog-cta-card__btn">View Publication</Link>
                                        <SubscribeButton publicationId={publication._id} size="sm" />
                                    </div>
                                </div>
                            )}

                        </div>

                        {
                            similarBlogs != null && similarBlogs.length ?
                                <>
                                    <h1 className="text-2xl mt-14 mb-10 font-semibold flex items-center gap-2">
                                        Similar Blogs
                                    </h1>

                                    {
                                        similarBlogs.map((blog, i) => {

                                            let { author: { personal_info } } = blog;

                                            return <AnimationWrapper key={i} transition={{duration: 0.4, delay: i*0.05}}>
                                                <BlogPostCard content={blog} author={personal_info} />
                                            </AnimationWrapper>

                                        })
                                    }
                                </>
                            : ""
                        }
                        </div>
                    </div>
                    )}
                        </div>
                        {isTextPost && <RightSidebar />}
                    </div>
                </BlogContext.Provider>
            }
        </AnimationWrapper>
    )
}

export default BlogPage;