import { useContext, useState } from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { ThemeContext, UserContext } from "../App";
import { storeInSession, removeFromSession } from "../common/session";
import { revokeSessionOnServer } from "../common/api";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../common/queryKeys";
import Icon from "./Icon";
import Logo from "./Logo";
import KeepReading from "./keep-reading.component";
import TextPostComposer from "./text-post-composer.component";
import Avatar from "./Avatar";
import { useUnreadMessages, useNewNotification } from "../hooks/queries";

const navItems = [
    { to: "/", icon: "home", label: "Home", end: true },
    { to: "/reads", icon: "auto_stories", label: "Articles" },
    { to: "/subscriptions", icon: "subscriptions", label: "Subscriptions", authOnly: true },
    { to: "/dashboard/publications", icon: "import_contacts", label: "Publications", authOnly: true },
    { to: "/collections", icon: "collections_bookmark", label: "Collections", authOnly: true },
    { to: "/dashboard/notifications", icon: "notifications", label: "Activity", authOnly: true },
    { to: "/messages", icon: "forum", label: "Chat", authOnly: true },
];

const dashboardItems = [
    { to: "/dashboard/blogs", icon: "article", label: "Blogs" },
    { to: "/dashboard/drafts", icon: "draft", label: "Drafts" },
    { to: "/dashboard/bookmarks", icon: "collections_bookmark", label: "Collections" },
    { to: "/dashboard/notifications", icon: "notifications", label: "Activity", showBadge: true },

    { to: "/dashboard/publications", icon: "import_contacts", label: "Publications" },
    { to: "/dashboard/analytics", icon: "bar_chart", label: "Analytics" },
    { to: "/messages", icon: "forum", label: "Chat" },
    { to: "/editor", icon: "edit_note", label: "Write" },
];

const settingsItems = [
    { to: "/settings/profile", icon: "person", label: "Profile" },
    { to: "/settings/edit-profile", icon: "edit", label: "Edit Profile" },
    { to: "/settings/change-password", icon: "lock", label: "Change Password" },
    { to: "/settings/notification-preferences", icon: "notifications_active", label: "Notifications" },
    { to: "/settings/privacy", icon: "shield", label: "Privacy" },
    { to: "/settings/blocked-users", icon: "block", label: "Blocked Users" },
    { to: "/settings/account", icon: "manage_accounts", label: "Account" },
];

const LeftSidebar = () => {

    const { userAuth: { access_token, profile_img, username, fullname }, setUserAuth } = useContext(UserContext);
    const { theme, setTheme } = useContext(ThemeContext);
    const navigate = useNavigate();
    const location = useLocation();

    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [showComposer, setShowComposer] = useState(false);
    const queryClient = useQueryClient();

    // TanStack Query — socket-cache bridge handles real-time updates
    const { data: unreadMessages = 0 } = useUnreadMessages();
    const { data: notificationData } = useNewNotification();
    const new_notification_available = notificationData?.new_notification_available;

    const [showProfileMenu, setShowProfileMenu] = useState(false);

    // Detect if we're in dashboard/settings mode
    const [isDashboardOrSettings, setIsDashboardOrSettings] = useState(() => {
        const path = location.pathname;
        return (path.startsWith("/dashboard") && !path.startsWith("/dashboard/notifications") && !path.startsWith("/dashboard/publications")) || path.startsWith("/settings");
    });

    // Track previous path to update dashboard mode synchronously during render
    const [prevPath, setPrevPath] = useState(location.pathname);

    if (location.pathname !== prevPath) {
        setPrevPath(location.pathname);
        const path = location.pathname;
        const isHybrid = path.startsWith("/dashboard/notifications") || 
                         path.startsWith("/dashboard/publications") || 
                         path.startsWith("/messages");
                         
        if (!isHybrid) {
            setIsDashboardOrSettings(path.startsWith("/dashboard") || path.startsWith("/settings"));
        }
    }

    const signOutUser = () => {
        revokeSessionOnServer(); // best-effort: invalidate this device's refresh session server-side
        removeFromSession("user");
        setUserAuth({ access_token: null });
        navigate("/");
    };

    const changeTheme = () => {
        const newTheme = theme === "light" ? "dark" : "light";
        if (newTheme === "light") {
            document.documentElement.setAttribute("data-theme", "light");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
        setTheme(newTheme);
        storeInSession("theme", newTheme);
    };

    const handleCreateTextPost = () => {
        setShowCreateMenu(false);
        setShowComposer(true);
    };

    const handleCreateArticle = () => {
        setShowCreateMenu(false);
        navigate("/editor");
    };

    return (
        <>
        <aside className="left-sidebar">

            {/* === DASHBOARD/SETTINGS MODE === */}
            {isDashboardOrSettings && access_token ? (
                <div key="dashboard-mode" className="left-sidebar__mode-content">
                    {/* Back to Home button (replaces logo) */}
                    <Link to="/" className="left-sidebar__back-btn">
                        <Icon name="arrow_back" className="text-[20px]" />
                        <span>Back to Home</span>
                    </Link>

                    {/* Dashboard nav section */}
                    <nav className="left-sidebar__nav left-sidebar__nav--sectioned">
                        <h3 className="left-sidebar__section-header">Dashboard</h3>
                        {dashboardItems.map(({ to, icon, label, showBadge }) => {
                            const searchParams = new URLSearchParams(location.search);
                            const currentTab = searchParams.get("tab");
                            let isItemActive = false;
                            
                            if (to === "/dashboard/blogs") {
                                isItemActive = location.pathname === "/dashboard/blogs" && currentTab !== "draft";
                            } else if (to === "/dashboard/drafts") {
                                isItemActive = location.pathname === "/dashboard/drafts" || (location.pathname === "/dashboard/blogs" && currentTab === "draft");
                            } else {
                                isItemActive = location.pathname === to || location.pathname.startsWith(to + "/");
                            }

                            return (
                                <Link
                                    key={to}
                                    to={to}
                                    className={"left-sidebar__link" + (isItemActive ? " active" : "")}
                                >
                                    <div className="relative">
                                        <Icon name={icon} className="text-[22px]" filled={isItemActive} />
                                        {showBadge && new_notification_available && (
                                            <span className="notification-badge !w-2 !h-2 !top-0 !right-0"></span>
                                        )}
                                        {icon === "forum" && unreadMessages > 0 && (
                                            <span className="notification-badge !w-2 !h-2 !top-0 !right-0"></span>
                                        )}
                                    </div>
                                    <span>{label}</span>
                                </Link>
                            );
                        })}

                        <h3 className="left-sidebar__section-header left-sidebar__section-header--spaced">Settings</h3>
                        {settingsItems.map(({ to, icon, label }) => (
                            <NavLink
                                key={to}
                                to={to}
                                end
                                className={({ isActive }) =>
                                    "left-sidebar__link" + (isActive ? " active" : "")
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Icon name={icon} className="text-[22px]" filled={isActive} />
                                        <span>{label}</span>
                                    </>
                                )}
                            </NavLink>
                        ))}
                        
                        <button
                            className="left-sidebar__link"
                            onClick={changeTheme}
                            aria-label="Toggle theme"
                        >
                            <Icon name={theme === "light" ? "dark_mode" : "light_mode"} className="text-[22px]" />
                            <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
                        </button>
                    </nav>
                </div>
            ) : (
                /* === NORMAL MODE === */
                <div key="normal-mode" className="left-sidebar__mode-content">
                    {/* Logo */}
                    <Link to="/" state={{ resetScroll: true }} className="left-sidebar__logo flex items-center">
                        <Logo />
                        <span className="beta-badge ml-2">BETA</span>
                    </Link>

                    {/* Navigation */}
                    <nav className="left-sidebar__nav">
                        {navItems.map(({ to, icon, label, end, authOnly }) => {
                            if (authOnly && !access_token) return null;

                            return (
                                <NavLink
                                    key={to}
                                    to={to}
                                    end={end}
                                    className={({ isActive }) =>
                                        "left-sidebar__link" + (isActive ? " active" : "")
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className="relative">
                                                <Icon name={icon} className="text-[22px]" filled={isActive} />
                                                {icon === "notifications" && new_notification_available && (
                                                    <span className="notification-badge !w-2 !h-2 !top-0 !right-0"></span>
                                                )}
                                                {icon === "forum" && unreadMessages > 0 && (
                                                    <span className="notification-badge !w-2 !h-2 !top-0 !right-0"></span>
                                                )}
                                            </div>
                                            <span>{label}</span>
                                        </>
                                    )}
                                </NavLink>
                            );
                        })}
                    </nav>

                    {/* Create Button with Dropdown */}
                    {access_token ? (
                        <div className="create-menu">
                            <button
                                className="left-sidebar__write-btn"
                                onClick={() => setShowCreateMenu(prev => !prev)}
                            >
                                <Icon name="add" className="text-xl" />
                                <span>Create</span>
                            </button>

                            {showCreateMenu && (
                                <>
                                    <div className="create-menu__backdrop" onClick={() => setShowCreateMenu(false)} />
                                    <div className="create-menu__dropdown">
                                        <button className="create-menu__item" onClick={handleCreateTextPost}>
                                            <span className="create-menu__item-icon">
                                                <Icon name="edit_note" className="text-xl" />
                                            </span>
                                            <span className="create-menu__item-text">
                                                <span className="create-menu__item-label">Post</span>
                                                <span className="create-menu__item-desc">Share a quick thought</span>
                                            </span>
                                        </button>
                                        <button className="create-menu__item" onClick={handleCreateArticle}>
                                            <span className="create-menu__item-icon">
                                                <Icon name="article" className="text-xl" />
                                            </span>
                                            <span className="create-menu__item-text">
                                                <span className="create-menu__item-label">Article</span>
                                                <span className="create-menu__item-desc">Long form article post</span>
                                            </span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <Link to="/signin" className="left-sidebar__write-btn">
                            <span>Sign In</span>
                        </Link>
                    )}

                    {/* Keep Reading — signed-in only */}
                    {access_token && <KeepReading />}

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Footer + copyright (logged out only) */}
                    {!access_token && (
                        <div className="left-sidebar__footer">
                            <p className="left-sidebar__copyright">© 2026 Kalamio</p>
                            <div className="left-sidebar__footer-links">
                                <a href="#">About</a>
                                <a href="#">Help</a>
                                <a href="#">Terms</a>
                                <a href="#">Privacy</a>
                            </div>
                        </div>
                    )}

                    {/* User Profile Menu */}
                    <div className="left-sidebar__bottom">
                        {!access_token && (
                            <button
                                className="left-sidebar__link"
                                onClick={changeTheme}
                                aria-label="Toggle theme"
                            >
                                <Icon name={theme === "light" ? "dark_mode" : "light_mode"} className="text-[22px]" />
                                <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
                            </button>
                        )}

                        {access_token && (
                            <div className="left-sidebar__profile-menu">
                                <button
                                    className="left-sidebar__profile-trigger"
                                    onClick={() => setShowProfileMenu(prev => !prev)}
                                >
                                    <div className="relative shrink-0">
                                        {profile_img ? (
                                            <Avatar src={profile_img} alt={username} size={32} className="border border-[rgb(var(--c-border))]" />
                                        ) : (
                                            <Icon name="person" className="text-[24px]" />
                                        )}
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1 justify-center text-left gap-0">
                                        <span className="font-semibold text-black text-[13px] leading-[1.2] truncate">
                                            {fullname || username}
                                        </span>
                                        <span className="text-dark-grey text-[11px] leading-[1.2] truncate">
                                            @{username}
                                        </span>
                                    </div>
                                    <Icon name="unfold_more" className="text-dark-grey text-[16px] shrink-0" />
                                </button>

                                {showProfileMenu && (
                                    <>
                                        <div className="left-sidebar__profile-backdrop" onClick={() => setShowProfileMenu(false)} />
                                        <div className="left-sidebar__profile-dropdown">
                                            <Link to={`/user/${username}`} className="left-sidebar__profile-dropdown-item" onClick={() => setShowProfileMenu(false)}>
                                                <Icon name="person" className="text-[20px]" />
                                                <span>Profile</span>
                                            </Link>
                                            <Link to="/dashboard/blogs" className="left-sidebar__profile-dropdown-item" onClick={() => setShowProfileMenu(false)}>
                                                <Icon name="dashboard" className="text-[20px]" />
                                                <span>Dashboard</span>
                                            </Link>
                                            <button className="left-sidebar__profile-dropdown-item" onClick={() => { changeTheme(); setShowProfileMenu(false); }}>
                                                <Icon name={theme === "light" ? "dark_mode" : "light_mode"} className="text-[20px]" />
                                                <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
                                            </button>
                                            <div className="left-sidebar__profile-dropdown-divider" />
                                            <button className="left-sidebar__profile-dropdown-item" onClick={() => { setShowProfileMenu(false); signOutUser(); }}>
                                                <Icon name="logout" className="text-[20px]" />
                                                <span>Log out</span>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </aside>

        {/* Text Post Composer Modal */}
        <TextPostComposer
            isOpen={showComposer}
            onClose={() => setShowComposer(false)}
            onPosted={() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.blogs.latest() });
                queryClient.invalidateQueries({ queryKey: queryKeys.blogs.following() });
            }}
        />
        </>
    );
};

export default LeftSidebar;
