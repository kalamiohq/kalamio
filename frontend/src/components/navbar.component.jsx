import { useContext, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { ThemeContext, UserContext } from "../App";
import Logo from "./Logo";
import UserNavigationPanel from "./user-navigation.component";
import { storeInSession } from "../common/session";
import Icon from "./Icon";
import Avatar from "./Avatar";
import { useNewNotification, useUnreadMessages } from "../hooks/queries";

const Navbar = () => {

    const [ searchBoxVisibility, setSearchBoxVisibility ] = useState(false)
    const [ userNavPanel, setUserNavPanel ] = useState(false);
    const { userAuth, userAuth: { access_token, profile_img }, setUserAuth } =  useContext(UserContext);

    let { theme, setTheme } = useContext(ThemeContext);

    // TanStack Query hooks — auto-poll + socket-invalidated
    const { data: notificationData } = useNewNotification();
    const { data: unreadMessages = 0 } = useUnreadMessages();
    const new_notification_available = notificationData?.new_notification_available;

    let navigate = useNavigate();

    const handleUserNavPanel = () => {
        setUserNavPanel(currentVal => !currentVal);
    }

    const handleSearch = (e) => {
        let query = e.target.value;

        if(e.keyCode == 13 && query.length){
            // Encode: raw queries containing /, #, ? or % break the :query route param
            navigate(`/search/${encodeURIComponent(query)}`)
        }
    }

    const handleBlur = () => {
        setTimeout(() => {
            setUserNavPanel(false);
        }, 300);
    }

    const changeTheme = () => {
        const newTheme = theme === "light" ? "dark" : "light";
        if (newTheme === "light") {
            document.documentElement.setAttribute("data-theme", "light");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
        setTheme(newTheme);
        storeInSession("theme", newTheme);
    }

    return(

        <>
            <nav className="navbar z-50">

                <Link to="/" state={{ resetScroll: true }} className="flex-none flex items-center gap-2">
                    <Logo wordmark={false} className="h-8 w-8" />
                    <span className="beta-badge">BETA</span>
                </Link>

                <div className={"absolute w-full left-0 top-full mt-0.5 border-b border-border py-4 px-[5vw] md:border-0 md:block md:relative md:inset-0 md:p-0 md:w-auto md:show md:bg-transparent md:backdrop-blur-none " + (searchBoxVisibility ? "show" : "hide")} style={{ background: 'rgb(var(--c-white) / 0.9)', backdropFilter: 'blur(16px)' }}>
                    <input 
                        type="text"
                        placeholder="Search"
                        className="w-full md:w-auto bg-grey p-4 pl-6 pr-[12%] md:pr-6 rounded-full placeholder:text-dark-grey md:pl-12 border border-transparent focus:border-border focus:bg-surface transition-all"
                        onKeyDown={handleSearch}  
                    />

                    <Icon name="search" className="absolute right-[10%] md:pointer-events-none md:left-5 top-1/2 -translate-y-1/2 text-xl text-dark-grey" />
                </div>

                <div className="flex items-center gap-3 md:gap-6 ml-auto">
                    <button className="md:hidden bg-grey w-12 h-12 rounded-full flex items-center justify-center hover:bg-grey/80 transition-colors"
                    onClick={()=>setSearchBoxVisibility(currentVal => !currentVal)}
                    >
                        <Icon name="search" className="text-xl" />
                    </button>

                    <Link to="/editor" className="hidden md:flex gap-2 items-center btn-brand py-2 px-5 text-base">
                        <Icon name="edit_note" />
                        <p>Write</p>
                    </Link>

                    <button 
                        className="w-12 h-12 rounded-full bg-grey relative hover:bg-grey/80 flex items-center justify-center transition-colors"
                        onClick={changeTheme}
                        aria-label="Toggle theme"
                    >
                        <Icon name={theme === "light" ? "dark_mode" : "light_mode"} className="text-2xl" />
                    </button>


                    {
                        access_token ?
                        <>
                            <Link to="/dashboard/notifications">
                                <button className="w-12 h-12 rounded-full bg-grey relative hover:bg-grey/80 flex items-center justify-center transition-colors">
                                    <Icon name="notifications" className="text-2xl" />
                                    {
                                        new_notification_available ? 
                                        <span className="notification-badge"></span> : " "
                                    }
                                </button>
                            </Link>

                            <Link to="/messages">
                                <button className="w-12 h-12 rounded-full bg-grey relative hover:bg-grey/80 flex items-center justify-center transition-colors">
                                    <Icon name="chat" className="text-2xl" />
                                    {
                                        unreadMessages > 0 ?
                                        <span className="notification-badge">{unreadMessages > 9 ? '9+' : unreadMessages}</span> : " "
                                    }
                                </button>
                            </Link>

                            <div className="relative" onClick={handleUserNavPanel} onBlur={handleBlur}>
                                <button className="w-12 h-12 mt-1">
                                    <Avatar src={profile_img} alt="Profile" size={44} />
                                </button>

                                {
                                    userNavPanel ? <UserNavigationPanel /> : ""
                                }

                            </div>
                        </>
                        :
                        <>    
                            <Link to="/signin" className="btn-dark py-2">
                                Sign In
                            </Link>

                            <Link to="/signup" className="btn-light py-2 hidden md:block">
                                Sign Up
                            </Link>
                        </>
                    }


                </div>

            </nav>
        
            <Outlet />
        </>

    )
}

export default Navbar;