import { useSeo, PRODUCTION_ORIGIN } from "../common/useSeo";
import { useContext, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import AnimationWrapper from "../common/page-animation";
import Loader from "../components/loader.component";
import { UserContext } from "../App";
import AboutUser from "../components/about.component";
import BlogPostCard from "../components/blog-post.component";
import { cdnUrl } from "../common/cdn";
import TextPostCard from "../components/text-post-card.component";
import NoDataMessage from "../components/nodata.component";
import LoadMoreDataBtn from "../components/load-more.component";
import InPageNavigation from "../components/inpage-navigation.component";
import PageNotFound from "./404.page";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import FollowButton from "../components/follow-button.component";
import SubscribeButton from "../components/subscribe-button.component";
import toast from "react-hot-toast";
import NetworkError from "../components/network-error.component";
import { useUserProfile, useUserBlogs, useUserPublications, useUserCollections, useFollowsBack, useBlockStatus } from "../hooks/queries";
import { useBlockAction } from "../hooks/mutations";

export const profileDataStructure = {
    personal_info: {
        fullname: "",
        username: "",
        profile_img: "",
        bio: "" 
    },
    account_info: {
        total_posts: 0,
        total_reads: 0,
        total_followers: 0,
        total_following: 0,
    },
    social_links: {},
    joinedAt: ""
}

const ProfilePage = () => {

    let { id: profileId } = useParams();
    let { userAuth: { username, access_token } } = useContext(UserContext);
    profileId = profileId || username;

    const navigate = useNavigate();

    // ── Query hooks ─────────────────────────────────────────────
    const profileQuery = useUserProfile(profileId);
    const profile = profileQuery.data || profileDataStructure;

    let { 
        personal_info: { fullname, username: profile_username, profile_img, bio }, 
        account_info: { total_posts, total_reads, total_followers, total_following },
        social_links, joinedAt, _id: profileUserId
    } = profile;

    // User's blogs (infinite query)
    const blogsQuery = useUserBlogs({ userId: profileUserId });

    // User's publications
    const { data: publications } = useUserPublications(profileUserId);

    // User's public collections
    const { data: profileCollections = [] } = useUserCollections(profile?.personal_info?.username);

    // Social status checks
    const { data: followsYou } = useFollowsBack(profileUserId);
    const { data: blockData } = useBlockStatus(profileUserId);
    const isBlocked = blockData?.is_blocked && blockData?.direction === 'blocker';

    // Block mutation
    const blockMutation = useBlockAction();

    const seoTitle = fullname || (profile_username ? `@${profile_username}` : 'Profile');
    const seoDescription = (bio && bio.trim())
        ? (bio.length > 160 ? bio.slice(0, 157).trimEnd() + '…' : bio)
        : (profile_username ? `@${profile_username} on Kalamio` : undefined);
    const canonicalUrl = profile_username ? `${PRODUCTION_ORIGIN}/user/${profile_username}` : undefined;
    const apiOrigin = (import.meta.env.VITE_SERVER_DOMAIN || `${PRODUCTION_ORIGIN}/`).replace(/\/+$/, '');
    const isPublicProfile =
        profile?.account_status?.status === 'active' &&
        profile?.privacy_settings?.show_profile === 'everyone';
    const rssUrl =
        profile_username && isPublicProfile
            ? `${apiOrigin}/api/v1/feed/user/${encodeURIComponent(profile_username)}.xml`
            : undefined;

    useSeo({
        title: seoTitle,
        description: seoDescription,
        image: profile_img || undefined,
        url: canonicalUrl,
        type: 'profile',
        rssUrl,
        rssTitle: profile_username ? `${seoTitle} RSS Feed` : undefined,
        jsonLd: profile_username ? {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            "mainEntity": {
                "@type": "Person",
                "name": fullname || profile_username,
                "alternateName": `@${profile_username}`,
                "url": canonicalUrl,
                ...(profile_img ? { "image": profile_img } : {}),
                ...(bio && bio.trim() ? { "description": bio } : {})
            }
        } : null
    });

    // Track follower count locally for instant UI update
    const [localFollowerDelta, setLocalFollowerDelta] = useState(0);

    const handleFollowChange = (isNowFollowing) => {
        setLocalFollowerDelta(prev => prev + (isNowFollowing ? 1 : -1));
    };

    const displayFollowers = total_followers + localFollowerDelta;

    // Flatten infinite query blogs
    const blogs = blogsQuery.data?.blogs || [];

    return (
      <AnimationWrapper>
        {profileQuery.isLoading ? (
          <Loader />
        ) : profileQuery.isError ? (
          // The API answers 404 for unknown/deleted/deactivated usernames. That's a missing page,
          // not a failed request — showing "something went wrong" with a Retry that can never
          // succeed is misleading, so a 404 falls through to the same PageNotFound used below.
          profileQuery.error?.response?.status === 404 ? (
            <PageNotFound />
          ) : (
            <NetworkError onRetry={() => profileQuery.refetch()} />
          )
        ) : (
            profile_username.length ? 
                <section className="h-cover lg:flex flex-row-reverse items-start gap-5 min-[1100px]:gap-12 max-lg:pt-0">
                    <div className="flex flex-col max-lg:items-center gap-5 min-w-[250px] lg:max-w-[350px] w-full lg:pl-8 lg:border-l border-border lg:sticky lg:top-[100px] lg:py-10 ">
                        <div className="flex items-center gap-4 w-full lg:hidden mb-2 mt-4">
                            <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full hover:bg-grey flex items-center justify-center transition-colors -ml-2">
                                <Icon name="arrow_back" className="text-xl" />
                            </button>
                            <h1 className="font-semibold text-xl">Profile</h1>
                        </div>
                    
                    {/* Avatar with gradient ring */}
                    <div className="relative">
                        <div className="w-32 h-32 rounded-full p-[3px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgb(var(--c-brand)), rgb(var(--c-accent)))' }}>
                            <Avatar src={profile_img} alt={fullname} size={120} />
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold">@{profile_username}</h1>
                    <p className="text-xl capitalize text-dark-grey">{fullname}</p>

                    {/* Follows you badge */}
                    {followsYou && profileId !== username && (
                        <span className="follows-you-badge">Follows you</span>
                    )}

                    {/* Stats badges */}
                    <div className="flex gap-3 flex-wrap">
                        <div className="flex items-center gap-2 bg-grey rounded-full py-2 px-4">
                            <Icon name="article" className="text-black text-xl" />
                            <p className="text-black font-semibold text-sm">{total_posts.toLocaleString()}</p>
                            <span className="text-dark-grey text-sm">Articles</span>
                        </div>
                        <div className="flex items-center gap-2 bg-grey rounded-full py-2 px-4">
                            <Icon name="visibility" className="text-black text-xl" />
                            <span className="font-semibold">{total_reads.toLocaleString()}</span>
                            <span className="text-dark-grey text-sm">Reads</span>
                        </div>
                        <div className="flex items-center gap-2 bg-grey rounded-full py-2 px-4">
                            <Icon name="group" className="text-black text-xl" />
                            <span className="font-semibold">{displayFollowers.toLocaleString()}</span>
                            <span className="text-dark-grey text-sm">Followers</span>
                        </div>
                        <div className="flex items-center gap-2 bg-grey rounded-full py-2 px-4">
                            <Icon name="person_add" className="text-black text-xl" />
                            <span className="font-semibold">{total_following.toLocaleString()}</span>
                            <span className="text-dark-grey text-sm">Following</span>
                        </div>

                    </div>

                    <div className="flex gap-4 mt-2">
                        {profileId == username ? (
                        <Link
                            to="/settings/edit-profile"
                            className="btn-light rounded-radius-md flex items-center gap-2"
                        >
                            <Icon name="edit" className="text-xl" />
                            Edit Profile
                        </Link>
                        ) : (
                        <div className="flex gap-3 flex-wrap">
                            <FollowButton
                                targetUserId={profileUserId}
                                onFollowChange={handleFollowChange}
                                size="md"
                            />
                            <Link
                                to={`/messages?user=${profileUserId}`}
                                className="btn-light rounded-radius-md flex items-center gap-2"
                            >
                                <Icon name="chat" className="text-xl" />
                                Message
                            </Link>

                            <button
                                className={isBlocked ? "profile-block-btn profile-block-btn--active" : "profile-block-btn"}
                                onClick={() => {
                                    if (isBlocked) {
                                        blockMutation.mutate({ userId: profileUserId, action: 'unblock' });
                                    } else {
                                        if (!window.confirm(`Block @${profile_username}? They won't be able to follow you or send messages.`)) return;
                                        blockMutation.mutate({ userId: profileUserId, action: 'block' });
                                    }
                                }}
                                title={isBlocked ? "Unblock user" : "Block user"}
                            >
                                <Icon name="block" className="text-lg" />
                                {isBlocked ? "Unblock" : "Block"}
                            </button>
                        </div>
                        )}
                        {rssUrl && (
                            <a
                                href={rssUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-light rounded-radius-md flex items-center gap-2"
                            >
                                <Icon name="rss" className="text-xl" />
                                RSS
                            </a>
                        )}
                    </div>

                    <AboutUser
                        className="max-lg:hidden"
                        bio={bio}
                        social_links={social_links}
                        joinedAt={joinedAt}
                    />
                    </div>

                    <div className="max-lg:mt-12 w-full flex-1">
                    <InPageNavigation
                        routes={["All Published", "Publications", "Collections", "About"]}
                        defaultHidden={["About"]}
                    >

                        <>
                        {blogsQuery.isLoading ? (
                            <Loader />
                        ) : blogs.length ? (
                            blogs.map((blog, i) => {
                            return (
                                <AnimationWrapper
                                key={blog.blog_id || i}
                                once={blog.blog_id || i}
                                transition={{ duration: 0.4, delay: i * 0.05 }}
                                >
                                {blog.type === 'text_post' ? (
                                    <TextPostCard
                                        content={blog}
                                        author={blog.author.personal_info}
                                    />
                                ) : (
                                    <BlogPostCard
                                        content={blog}
                                        author={blog.author.personal_info}
                                    />
                                )}
                                </AnimationWrapper>
                            );
                            })
                        ) : (
                            <NoDataMessage message="No posts published" />
                        )}
                        <LoadMoreDataBtn
                            fetchNextPage={blogsQuery.fetchNextPage}
                            hasNextPage={blogsQuery.hasNextPage}
                            isFetchingNextPage={blogsQuery.isFetchingNextPage}
                        />
                        </>

                        {/* Publications Tab */}
                        <>
                        {publications == null ? (
                            <Loader />
                        ) : publications.length ? (
                            publications.map((pub, i) => (
                                <AnimationWrapper key={pub._id} once={pub._id} transition={{ duration: 0.4, delay: i * 0.05 }}>
                                    <div className="pub-profile-card">
                                        <Link to={`/publication/${pub.slug}`} className="pub-profile-card__title">
                                            <Icon name="import_contacts" className="pub-profile-card__icon" />
                                            {pub.title}
                                        </Link>
                                        {pub.description && (
                                            <p className="pub-profile-card__desc">{pub.description}</p>
                                        )}
                                        <div className="pub-profile-card__meta">
                                            <span><Icon name="group" className="text-sm" /> {pub.total_subscribers} subscribers</span>
                                            <span><Icon name="article" className="text-sm" /> {pub.total_posts} posts</span>
                                        </div>
                                        <SubscribeButton publicationId={pub._id} size="sm" />
                                    </div>
                                </AnimationWrapper>
                            ))
                        ) : (
                            <NoDataMessage message="No publications yet" />
                        )}
                        </>

                        {/* Collections Tab */}
                        <>
                            {profileCollections.length > 0 ? (
                                <div className="saved-page__grid">
                                    {profileCollections.map(col => (
                                        <Link key={col._id} to={`/collection/${col._id}`} className="saved-collection-card">
                                            <div className="saved-collection-card__cover">
                                                {col.cover_image
                                                    ? <img src={cdnUrl(col.cover_image)} alt={col.title} />
                                                    : <div className="saved-collection-card__cover-placeholder">
                                                        <Icon name={col.is_default ? 'schedule' : 'collections_bookmark'} className="text-3xl" />
                                                    </div>
                                                }
                                                <span className="saved-collection-card__count">
                                                    {col.total_articles} {col.total_articles === 1 ? 'article' : 'articles'}
                                                </span>
                                            </div>
                                            <div className="saved-collection-card__info">
                                                <h3 className="saved-collection-card__title">{col.title}</h3>
                                                <span className="saved-collection-card__visibility">
                                                    <Icon name={col.visibility === 'public' ? 'public' : 'link'} className="text-xs" />
                                                    {col.visibility}
                                                </span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <NoDataMessage message="No public collections" />
                            )}
                        </>

                        <AboutUser bio={bio} social_links={social_links} joinedAt={joinedAt} />
                        
                    </InPageNavigation>
                    </div>
                </section>
            : <PageNotFound />
        )}
      </AnimationWrapper>
    );
}

export default ProfilePage;