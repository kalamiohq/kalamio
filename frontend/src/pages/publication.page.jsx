import { useSeo, PRODUCTION_ORIGIN } from "../common/useSeo";
import { useContext, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../common/queryKeys";
import api from "../common/api";
import toast from "react-hot-toast";
import AnimationWrapper from "../common/page-animation";
import Loader from "../components/loader.component";
import NoDataMessage from "../components/nodata.component";
import LoadMoreDataBtn from "../components/load-more.component";
import BlogPostCard from "../components/blog-post.component";
import TextPostCard from "../components/text-post-card.component";
import SubscribeButton from "../components/subscribe-button.component";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import PageNotFound from "./404.page";
import NetworkError from "../components/network-error.component";
import { UserContext } from "../App";
import PublicationMenu from "../components/publication-menu.component";
import InPageNavigation from "../components/inpage-navigation.component";
import AboutPublication from "../components/about-publication.component";
import { cdnUrl } from "../common/cdn";

// Helper: creates an infinite query for a publication's blog feed
const usePubFeed = (publicationId, type) => {
    return useInfiniteQuery({
        queryKey: [...queryKeys.publications.detail(''), 'feed', publicationId, type || 'all'],
        queryFn: async ({ pageParam = 1 }) => {
            const body = { publication_id: publicationId, page: pageParam };
            if (type) body.type = type;

            const [blogsRes, countRes] = await Promise.all([
                api.post("/publication/blogs", body),
                pageParam === 1
                    ? api.post("/publication/blogs-count", { publication_id: publicationId, ...(type ? { type } : {}) })
                    : Promise.resolve(null),
            ]);

            return {
                blogs: blogsRes.data.blogs,
                totalDocs: countRes?.data?.totalDocs ?? undefined,
                page: pageParam,
            };
        },
        getNextPageParam: (lastPage, allPages) => {
            const totalLoaded = allPages.reduce((sum, p) => sum + p.blogs.length, 0);
            const totalDocs = allPages[0]?.totalDocs ?? 0;
            if (totalLoaded < totalDocs) return lastPage.page + 1;
            return undefined;
        },
        select: (data) => ({
            blogs: data.pages.flatMap(p => p.blogs),
            totalDocs: data.pages[0]?.totalDocs ?? 0,
        }),
        enabled: !!publicationId,
    });
};

const PublicationPage = () => {

    let { slug } = useParams();
    const navigate = useNavigate();

    const { userAuth: { access_token, username } } = useContext(UserContext);
    const queryClient = useQueryClient();

    // Track subscriber count locally for instant update
    const [localSubs, setLocalSubs] = useState(null);

    // Inline "New Collection" form state (owner only)
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");

    // Fetch publication metadata
    const { data: pubData, isLoading, isError, error, refetch } = useQuery({
        queryKey: queryKeys.publications.detail(slug),
        queryFn: async () => {
            const { data } = await api.post("/publication/get", { slug });
            return data.publication;
        },
        staleTime: 10 * 60 * 1000,
    });

    const publication = pubData;
    const pubId = publication?._id;

    // Sync localSubs when publication data loads
    if (publication && localSubs === null) {
        setLocalSubs(publication.total_subscribers);
    }

    const seoDescription = publication?.description
        ? (publication.description.length > 160
            ? publication.description.slice(0, 157).trimEnd() + '...'
            : publication.description)
        : undefined;

    const apiOrigin = (import.meta.env.VITE_SERVER_DOMAIN || `${PRODUCTION_ORIGIN}/`).replace(/\/+$/, '');
    const rssUrl =
        slug && publication?.visibility === 'public'
            ? `${apiOrigin}/api/v1/feed/publication/${encodeURIComponent(slug)}.xml`
            : undefined;

    useSeo({
        title: publication?.title || 'Publication',
        description: seoDescription,
        image: publication?.profile_photo || publication?.banner || undefined,
        url: `${PRODUCTION_ORIGIN}/publication/${slug}`,
        type: 'website',
        rssUrl,
        rssTitle: publication?.title ? `${publication.title} RSS Feed` : undefined,
    });

    // 3 separate infinite queries for each tab
    const allFeedQuery = usePubFeed(pubId, null);
    const articlesFeedQuery = usePubFeed(pubId, 'blog');
    const textPostsFeedQuery = usePubFeed(pubId, 'text_post');

    // Publication collections
    const pubCollectionsKey = [...queryKeys.collections.all(), 'publication', pubId];
    const { data: pubCollections = [] } = useQuery({
        queryKey: pubCollectionsKey,
        queryFn: async () => {
            const { data } = await api.post("/collection/publication-collections", { publication_id: pubId });
            return data.collections;
        },
        enabled: !!pubId,
        staleTime: 10 * 60 * 1000,
    });

    // Create a collection inside this publication. The list query has a long staleTime,
    // so it must be invalidated explicitly or the new collection won't show up.
    const createCollection = useMutation({
        mutationFn: ({ title }) =>
            api.post('/collection/create', {
                title,
                publication_id: pubId,
                visibility: 'public'
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: pubCollectionsKey });
            setNewTitle("");
            setCreating(false);
            toast.success('Collection created');
        },
        onError: (err) => {
            toast.error(err?.response?.data?.error || 'Failed to create collection');
        },
    });

    const handleCreateCollection = () => {
        const title = newTitle.trim();
        if (!title || createCollection.isPending) return;
        createCollection.mutate({ title });
    };

    const handleSubscribeChange = (isNowSubscribed) => {
        setLocalSubs(prev => prev + (isNowSubscribed ? 1 : -1));
    };

    if (isLoading) return <Loader />;
    // Only a genuine 404 means the publication doesn't exist; any other failure
    // (network/server) gets a retryable error state instead of "page not found".
    if (isError) {
        return error?.response?.status === 404
            ? <PageNotFound />
            : <NetworkError onRetry={() => refetch()} />;
    }
    if (!publication) return <PageNotFound />;

    const { title, description, banner, profile_photo, owner, tags, total_posts } = publication;
    const displaySubs = localSubs ?? publication.total_subscribers;

    const allBlogs = allFeedQuery.data?.blogs || [];
    const articlesBlogs = articlesFeedQuery.data?.blogs || [];
    const textPostsBlogs = textPostsFeedQuery.data?.blogs || [];

    return (
        <AnimationWrapper>
            <div className="publication-page">

                {/* Header */}
                <div className="publication-header">
                    <button 
                        onClick={() => navigate(-1)} 
                        className="publication-header__back-btn"
                        aria-label="Go back"
                    >
                        <Icon name="arrow_back" />
                    </button>
                    {banner && (
                        <div className="publication-header__banner">
                            <img src={cdnUrl(banner)} alt={title} />
                        </div>
                    )}
                    <div className="publication-header__content">
                        {/* Row: profile photo + info */}
                        <div className="publication-header__identity">
                            <div className="publication-header__profile-photo">
                                {profile_photo ? (
                                    <img src={cdnUrl(profile_photo)} alt={title} />
                                ) : (
                                    <span className="publication-header__profile-placeholder">
                                        {title.charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div className="publication-header__info">
                                <h1 className="publication-header__title">{title}</h1>
                                <div className="publication-header__meta-line">
                                    <Link to={`/user/${owner.personal_info.username}`} className="publication-header__handle">
                                        @{owner.personal_info.username}
                                    </Link>
                                    <span className="publication-header__meta-dot">·</span>
                                    <span>{displaySubs.toLocaleString()} subscribers</span>
                                    <span className="publication-header__meta-dot">·</span>
                                    <span>{total_posts.toLocaleString()} articles</span>
                                </div>
                                {description && (
                                    <div className="publication-header__description-wrapper">
                                        <span className="publication-header__description">{description}</span>
                                        <button 
                                            className="publication-header__more-btn"
                                            onClick={() => document.querySelector('[data-tab="About"]')?.click()}
                                        >
                                            ...more
                                        </button>
                                    </div>
                                )}
                                <div className="publication-header__actions">
                                    {rssUrl && (
                                        <a
                                            href={rssUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn-light rounded-radius-md flex items-center gap-2"
                                        >
                                            <Icon name="rss" className="text-lg" />
                                            RSS
                                        </a>
                                    )}
                                    <SubscribeButton
                                        publicationId={pubId}
                                        onSubscribeChange={handleSubscribeChange}
                                        size="md"
                                    />
                                    <PublicationMenu 
                                        publicationId={pubId} 
                                        ownerId={owner._id}
                                        ownerUsername={owner.personal_info.username}
                                        isOwner={username === owner.personal_info.username}
                                        onSubscribeChange={handleSubscribeChange}
                                    />
                                </div>
                            </div>
                        </div>

                        {tags?.length > 0 && (
                            <div className="publication-header__tags">
                                {tags.map((tag, i) => (
                                    <Link key={i} to={`/search/${encodeURIComponent(tag)}`} className="publication-tag">
                                        {tag}
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="w-full mt-4 px-4 md:px-0">
                    <InPageNavigation 
                        routes={["Home", "Articles", "Posts", "Collections", "About"]}
                        className="rounded-2xl"
                    >
                        
                        {/* Home Tab */}
                        <>
                            {allFeedQuery.isLoading ? <Loader /> :
                                allBlogs.length ?
                                    allBlogs.map((blog, i) => (
                                        <AnimationWrapper key={blog.blog_id} once={blog.blog_id} transition={{ duration: 0.4, delay: i * 0.04 }}>
                                            {blog.type === 'text_post' ? (
                                                <TextPostCard content={blog} author={blog.author.personal_info} />
                                            ) : (
                                                <BlogPostCard content={blog} author={blog.author.personal_info} />
                                            )}
                                        </AnimationWrapper>
                                    ))
                                : <NoDataMessage message="No posts in this publication yet" />
                            }
                            <LoadMoreDataBtn
                                fetchNextPage={allFeedQuery.fetchNextPage}
                                hasNextPage={allFeedQuery.hasNextPage}
                                isFetchingNextPage={allFeedQuery.isFetchingNextPage}
                            />
                        </>

                        {/* Articles Tab */}
                        <>
                            {articlesFeedQuery.isLoading ? <Loader /> :
                                articlesBlogs.length ?
                                    articlesBlogs.map((blog, i) => (
                                        <AnimationWrapper key={blog.blog_id} once={blog.blog_id} transition={{ duration: 0.4, delay: i * 0.04 }}>
                                            <BlogPostCard content={blog} author={blog.author.personal_info} />
                                        </AnimationWrapper>
                                    ))
                                : <NoDataMessage message="No articles in this publication yet" />
                            }
                            <LoadMoreDataBtn
                                fetchNextPage={articlesFeedQuery.fetchNextPage}
                                hasNextPage={articlesFeedQuery.hasNextPage}
                                isFetchingNextPage={articlesFeedQuery.isFetchingNextPage}
                            />
                        </>

                        {/* Posts Tab */}
                        <>
                            {textPostsFeedQuery.isLoading ? <Loader /> :
                                textPostsBlogs.length ?
                                    textPostsBlogs.map((blog, i) => (
                                        <AnimationWrapper key={blog.blog_id} once={blog.blog_id} transition={{ duration: 0.4, delay: i * 0.04 }}>
                                            <TextPostCard content={blog} author={blog.author.personal_info} />
                                        </AnimationWrapper>
                                    ))
                                : <NoDataMessage message="No text posts in this publication yet" />
                            }
                            <LoadMoreDataBtn
                                fetchNextPage={textPostsFeedQuery.fetchNextPage}
                                hasNextPage={textPostsFeedQuery.hasNextPage}
                                isFetchingNextPage={textPostsFeedQuery.isFetchingNextPage}
                            />
                        </>

                        {/* Collections Tab */}
                        <>
                            {publication.owner?.personal_info?.username === username && (
                                <>
                                    <button
                                        className="btn-dark btn-sm mb-4"
                                        onClick={() => setCreating(!creating)}
                                    >
                                        <Icon name="add" className="text-lg" /> New Collection
                                    </button>
                                    {creating && (
                                        <div className="saved-page__create-form">
                                            <input
                                                type="text"
                                                placeholder="Collection name..."
                                                className="input-box"
                                                value={newTitle}
                                                onChange={(e) => setNewTitle(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                                                maxLength={100}
                                                autoFocus
                                            />
                                            <div className="saved-page__create-row">
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button
                                                        className="btn-dark btn-sm"
                                                        onClick={handleCreateCollection}
                                                        disabled={!newTitle.trim() || createCollection.isPending}
                                                    >
                                                        {createCollection.isPending ? 'Creating...' : 'Create'}
                                                    </button>
                                                    <button className="btn-light btn-sm" onClick={() => setCreating(false)}>Cancel</button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                            {pubCollections.length === 0
                                ? <NoDataMessage message="No collections in this publication yet" />
                                : <div className="saved-page__grid">
                                    {pubCollections.map(col => (
                                        <Link key={col._id} to={`/collection/${col._id}`} className="saved-collection-card">
                                            <div className="saved-collection-card__cover">
                                                {col.cover_image
                                                    ? <img src={cdnUrl(col.cover_image)} alt={col.title} />
                                                    : <div className="saved-collection-card__cover-placeholder">
                                                        <Icon name="collections_bookmark" className="text-3xl" />
                                                    </div>
                                                }
                                                <span className="saved-collection-card__count">
                                                    {col.total_articles} {col.total_articles === 1 ? 'article' : 'articles'}
                                                </span>
                                            </div>
                                            <div className="saved-collection-card__info">
                                                <h3 className="saved-collection-card__title">{col.title}</h3>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            }
                        </>

                        {/* About Tab */}
                        <AboutPublication 
                            description={publication.description} 
                            social_links={publication.social_links}
                            createdAt={publication.createdAt}
                            total_reads={publication.total_reads}
                        />

                    </InPageNavigation>
                </div>
            </div>
        </AnimationWrapper>
    );
};

export default PublicationPage;
