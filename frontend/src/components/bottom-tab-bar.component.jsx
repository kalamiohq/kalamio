import { useContext, useState } from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { UserContext } from "../App";
import Icon from "./Icon";
import Avatar from "./Avatar";
import TextPostComposer from "./text-post-composer.component";
import { useUnreadMessages } from "../hooks/queries";

const BottomTabBar = () => {

    const { userAuth: { access_token, profile_img } } = useContext(UserContext);
    const navigate = useNavigate();
    const location = useLocation();

    const [showFabMenu, setShowFabMenu] = useState(false);
    const [showComposer, setShowComposer] = useState(false);

    // Live unread-message count — polled every 60s, and invalidated by chat-view on mark-read and by
    // the socket→cache bridge on new_message while the socket is open.
    const { data: unreadMessages = 0 } = useUnreadMessages();

    const handleCreateTextPost = () => {
        setShowFabMenu(false);
        setShowComposer(true);
    };

    const handleCreateArticle = () => {
        setShowFabMenu(false);
        navigate(access_token ? "/editor" : "/signin");
    };

    const handleFabClick = () => {
        if (!access_token) {
            navigate("/signin");
            return;
        }
        setShowFabMenu(prev => !prev);
    };

    return (
        <>
        <nav className="bottom-tab-bar">
            <NavLink to="/" end className={({ isActive }) => "bottom-tab-bar__item" + (isActive ? " active" : "")}>
                {({ isActive }) => (
                    <>
                        <Icon name="home" className="text-2xl" filled={isActive} />
                        <span>Home</span>
                    </>
                )}
            </NavLink>

            <NavLink to="/reads" className={({ isActive }) => "bottom-tab-bar__item" + (isActive ? " active" : "")}>
                {({ isActive }) => (
                    <>
                        <Icon name="auto_stories" className="text-2xl" filled={isActive} />
                        <span>Articles</span>
                    </>
                )}
            </NavLink>

            {access_token ? (
                <NavLink to="/messages" className={({ isActive }) => "bottom-tab-bar__item" + (isActive ? " active" : "")}>
                    {({ isActive }) => (
                        <>
                            <div className="relative">
                                <Icon name="forum" className="text-2xl" filled={isActive} />
                                {unreadMessages > 0 && (
                                    <span className="notification-badge !w-2 !h-2 !top-0 !right-0"></span>
                                )}
                            </div>
                            <span>Chat</span>
                        </>
                    )}
                </NavLink>
            ) : (
                // Logged out: a plain Link (not NavLink) so it never reads as "active" — all three
                // logged-out tabs point at /signin, so NavLinks would all highlight together there.
                <Link to="/signin" className="bottom-tab-bar__item">
                    <Icon name="forum" className="text-2xl" />
                    <span>Chat</span>
                </Link>
            )}

            {access_token ? (
                <NavLink to="/subscriptions" className={({ isActive }) => "bottom-tab-bar__item" + (isActive ? " active" : "")}>
                    {({ isActive }) => (
                        <>
                            <Icon name="subscriptions" className="text-2xl" filled={isActive} />
                            <span>Subs</span>
                        </>
                    )}
                </NavLink>
            ) : (
                <Link to="/signin" className="bottom-tab-bar__item">
                    <Icon name="subscriptions" className="text-2xl" />
                    <span>Subs</span>
                </Link>
            )}

            {access_token ? (
                <NavLink
                    to="/you"
                    className={() => {
                        const isYouActive = location.pathname === "/you" ||
                            location.pathname.startsWith("/dashboard") ||
                            location.pathname.startsWith("/settings");
                        return "bottom-tab-bar__item" + (isYouActive ? " active" : "");
                    }}
                >
                    {() => {
                        const isYouActive = location.pathname === "/you" ||
                            location.pathname.startsWith("/dashboard") ||
                            location.pathname.startsWith("/settings");
                        return (
                            <>
                                {profile_img ? (
                                    <Avatar src={profile_img} size={24} />
                                ) : (
                                    <Icon name="person" className="text-2xl" filled={isYouActive} />
                                )}
                                <span>You</span>
                            </>
                        );
                    }}
                </NavLink>
            ) : (
                <Link to="/signin" className="bottom-tab-bar__item">
                    <Icon name="person" className="text-2xl" />
                    <span>You</span>
                </Link>
            )}
        </nav>

        {/* Floating Action Button (FAB) — bottom right, only on Home */}
        {access_token && location.pathname === "/" && (
            <div className="fab-container">
                {showFabMenu && (
                    <>
                        <div className="fab-backdrop" onClick={() => setShowFabMenu(false)} />
                        <div className="fab-menu">
                            <button className="fab-menu__item" onClick={handleCreateTextPost}>
                                <span className="fab-menu__label">Post</span>
                                <span className="fab-menu__icon">
                                    <Icon name="edit_note" className="text-xl" />
                                </span>
                            </button>
                            <button className="fab-menu__item" onClick={handleCreateArticle}>
                                <span className="fab-menu__label">Article</span>
                                <span className="fab-menu__icon">
                                    <Icon name="article" className="text-xl" />
                                </span>
                            </button>
                        </div>
                    </>
                )}
                <button
                    className={`fab-button ${showFabMenu ? "fab-button--active" : ""}`}
                    onClick={handleFabClick}
                    aria-label="Create"
                >
                    <Icon name={showFabMenu ? "close" : "add"} className="text-3xl" />
                </button>
            </div>
        )}

        {/* Text Post Composer Modal */}
        <TextPostComposer
            isOpen={showComposer}
            onClose={() => setShowComposer(false)}
            onPosted={() => {
                window.location.reload();
            }}
        />
        </>
    );
};

export default BottomTabBar;
