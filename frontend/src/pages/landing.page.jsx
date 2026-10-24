// Landing page (/welcome) — a single-viewport, zero-scroll intro to Kalamio.
// The hero headline keeps shuffling through topics ("Want to write about Productivity?"),
// topic chips float around it with mouse parallax, and a cursor spotlight + marquee
// round out the stage. Everything runs on the app's theme tokens.
import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useSpring,
    useTransform,
    useReducedMotion,
} from "framer-motion";
import { ThemeContext, UserContext } from "../App";
import { storeInSession } from "../common/session";
import { useSeo } from "../common/useSeo";
import Icon from "../components/Icon";
import Logo from "../components/Logo";

const TOPICS = [
    { label: "Productivity", icon: "schedule" },
    { label: "Technology", icon: "code" },
    { label: "AI", icon: "feedback" },
    { label: "Money", icon: "analytics" },
    { label: "Self Growth", icon: "trending_up" },
    { label: "Design", icon: "design_services" },
    { label: "Startups", icon: "work" },
    { label: "Travel", icon: "public" },
    { label: "Music", icon: "music_note" },
    { label: "Film", icon: "movie" },
    { label: "Philosophy", icon: "menu_book" },
    { label: "Fitness", icon: "favorite" },
];

// Floating chips: which topic each one shows, where it sits, how deep it
// parallaxes (px of travel at full mouse sweep) and its idle-bob timing.
const CHIPS = [
    { t: 0,  style: { top: "16%", left: "6%" },   depth: 34, bob: "7s",   bobDelay: "0s" },
    { t: 5,  style: { top: "13%", right: "9%" },  depth: 52, bob: "8.5s", bobDelay: "-2s" },
    { t: 3,  style: { top: "43%", left: "3%" },   depth: 70, bob: "9.5s", bobDelay: "-4s" },
    { t: 6,  style: { top: "40%", right: "4%" },  depth: 20, bob: "7.5s", bobDelay: "-1s" },
    { t: 8,  style: { bottom: "17%", left: "9%" }, depth: 46, bob: "8s",  bobDelay: "-5s" },
    { t: 1,  style: { bottom: "13%", right: "12%" }, depth: 44, bob: "9s", bobDelay: "-3s" },
    // The two bottom-center chips ride closest to the hint line, so they get the
    // flattest parallax and an extra short-viewport guard (hidden < 720px tall).
    { t: 10, style: { bottom: "5%", left: "24%" }, depth: 30, bob: "10s", bobDelay: "-6s", inner: true },
    { t: 7,  style: { bottom: "5%", right: "27%" }, depth: 30, bob: "10.5s", bobDelay: "-7s", inner: true },
];

const wordVariants = {
    enter: {},
    center: { transition: { staggerChildren: 0.032 } },
    exit: { transition: { staggerChildren: 0.014 } },
};

const letterVariants = {
    enter: { y: "115%", opacity: 0 },
    center: { y: "0%", opacity: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
    exit: { y: "-115%", opacity: 0, transition: { duration: 0.26, ease: [0.5, 0, 0.75, 0.4] } },
};

const fadeVariants = {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: 0.3 } },
    exit: { opacity: 0, transition: { duration: 0.2 } },
};

// The rotating word. mode="wait" lets the old word slide out before the new one
// slides in; each letter is masked by its own overflow-hidden wrapper. The
// underline redraws with the word since it lives inside the keyed element.
const RotatingWord = ({ topic, reduced }) => (
    <AnimatePresence mode="wait" initial={false}>
        <motion.span
            key={topic.label}
            className="landing__word"
            variants={reduced ? fadeVariants : wordVariants}
            initial="enter"
            animate="center"
            exit="exit"
        >
            {(topic.label + "?").split("").map((ch, i) => (
                <span className="landing__letter-mask" key={i}>
                    <motion.span
                        className={"landing__letter" + (ch === "?" ? " landing__letter--q" : "")}
                        variants={reduced ? undefined : letterVariants}
                    >
                        {ch === " " ? " " : ch}
                    </motion.span>
                </span>
            ))}
            <motion.svg
                className="landing__word-stroke"
                viewBox="0 0 120 10"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <motion.path
                    d="M3 7 Q 32 2.5 60 5.5 T 117 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    initial={reduced ? { pathLength: 1, opacity: 0 } : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.65 }}
                    transition={{ duration: 0.55, delay: reduced ? 0 : 0.3, ease: "easeOut" }}
                />
            </motion.svg>
        </motion.span>
    </AnimatePresence>
);

// One floating chip: outer layer = framer parallax transform, inner layer = CSS
// idle bob. Split in two because both want `transform` and would clobber each other.
const Chip = ({ chip, active, onPick, sx, sy }) => {
    const x = useTransform(sx, (v) => v * chip.depth);
    const y = useTransform(sy, (v) => v * chip.depth);
    const topic = TOPICS[chip.t];
    return (
        <motion.div
            className={"landing__chip-slot" + (chip.inner ? " landing__chip-slot--inner" : "")}
            style={{ ...chip.style, x, y }}
        >
            <span
                className="landing__chip-bob"
                style={{ animationDuration: chip.bob, animationDelay: chip.bobDelay }}
            >
                <button
                    type="button"
                    className={"landing__chip" + (active ? " is-active" : "")}
                    onClick={() => onPick(chip.t)}
                    aria-label={`${topic.label} — set headline topic`}
                    aria-pressed={active}
                >
                    <Icon name={topic.icon} className="landing__chip-icon" />
                    {topic.label}
                </button>
            </span>
        </motion.div>
    );
};

const LandingPage = () => {
    const { theme, setTheme } = useContext(ThemeContext);
    const { userAuth: { access_token } } = useContext(UserContext);
    const reduced = useReducedMotion();

    const [index, setIndex] = useState(0);
    // Hover and focus pause the rotation independently (focus also satisfies
    // WCAG 2.2.2's "pause auto-updating content" for keyboard users). Tracked
    // separately so a click (which focuses) doesn't fight a later mouseleave.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const paused = hovered || focused;

    useSeo({ title: "Write about anything", type: "website" });

    // Advance every 2.6s; picking a chip resets the clock by changing `index`.
    useEffect(() => {
        if (paused) return;
        const t = setTimeout(() => setIndex((i) => (i + 1) % TOPICS.length), 2600);
        return () => clearTimeout(t);
    }, [index, paused]);

    const shuffle = useCallback(() => setIndex((i) => (i + 1) % TOPICS.length), []);

    // Normalized cursor position (-0.5 … 0.5) drives chip parallax; raw pixels
    // drive the spotlight. Springs keep both trailing smoothly behind the cursor.
    // The spotlight sources are INITIALIZED at center-stage — a mount-effect
    // .jump() wouldn't help, because in framer-motion 10 a source jump still
    // spring-animates the useSpring output, sweeping the gradient across the
    // screen on load. (Client-only SPA, so window is safe at first render.)
    const nx = useMotionValue(0);
    const ny = useMotionValue(0);
    const cx = useMotionValue(typeof window !== "undefined" ? window.innerWidth / 2 : 0);
    const cy = useMotionValue(typeof window !== "undefined" ? window.innerHeight * 0.4 : 0);
    const sx = useSpring(nx, { stiffness: 55, damping: 18, mass: 0.7 });
    const sy = useSpring(ny, { stiffness: 55, damping: 18, mass: 0.7 });
    const spotX = useSpring(cx, { stiffness: 120, damping: 26, mass: 0.8 });
    const spotY = useSpring(cy, { stiffness: 120, damping: 26, mass: 0.8 });

    const handlePointerMove = (e) => {
        if (reduced) return;
        nx.set(e.clientX / window.innerWidth - 0.5);
        ny.set(e.clientY / window.innerHeight - 0.5);
        cx.set(e.clientX);
        cy.set(e.clientY);
    };

    const toggleTheme = () => {
        const newTheme = theme === "light" ? "dark" : "light";
        if (newTheme === "light") {
            document.documentElement.setAttribute("data-theme", "light");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
        setTheme(newTheme);
        storeInSession("theme", newTheme);
    };

    const topic = TOPICS[index];

    return (
        <div className="landing" onPointerMove={handlePointerMove}>
            {/* Backdrop: faint grid, cursor spotlight, film grain */}
            <div className="landing__grid" aria-hidden="true" />
            {!reduced && (
                <motion.div className="landing__spotlight" aria-hidden="true" style={{ x: spotX, y: spotY }} />
            )}
            <div className="landing__grain" aria-hidden="true" />

            <header className="landing__header">
                <Link to="/" className="landing__logo" aria-label="Kalamio home">
                    <Logo title={null} />
                    <span className="landing__beta">BETA</span>
                </Link>
                <div className="landing__header-actions">
                    <button
                        type="button"
                        className="landing__theme-btn"
                        onClick={toggleTheme}
                        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                    >
                        <Icon name={theme === "light" ? "dark_mode" : "light_mode"} />
                    </button>
                    {access_token ? (
                        <Link to="/" className="landing__btn-solid">Open Kalamio</Link>
                    ) : (
                        <>
                            <Link to="/signin" className="landing__signin">Sign in</Link>
                            <Link to="/signup" className="landing__btn-solid">Get started</Link>
                        </>
                    )}
                </div>
            </header>

            <main className="landing__hero">
                <div className="landing__chips">
                    {CHIPS.map((chip) => (
                        <Chip
                            key={chip.t}
                            chip={chip}
                            active={chip.t === index}
                            onPick={setIndex}
                            sx={sx}
                            sy={sy}
                        />
                    ))}
                </div>

                <div className="landing__center">
                    <motion.p
                        className="landing__eyebrow"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.05 }}
                    >
                        <span className="landing__eyebrow-star">✦</span>
                        A home for every voice
                        <span className="landing__eyebrow-star">✦</span>
                    </motion.p>

                    <motion.h1
                        className="landing__headline"
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.55, delay: 0.12 }}
                    >
                        <span className="landing__headline-line">Want to write about</span>
                        <button
                            type="button"
                            className="landing__word-btn"
                            onClick={shuffle}
                            onPointerEnter={(e) => { if (e.pointerType === "mouse") setHovered(true); }}
                            onPointerLeave={(e) => { if (e.pointerType === "mouse") setHovered(false); }}
                            onFocus={(e) => {
                                // Pause only for keyboard-visible focus — a touch tap
                                // also focuses (Android) but must not stick the pause.
                                let visible = true;
                                try { visible = e.target.matches(":focus-visible"); } catch { /* old engines: pause anyway */ }
                                if (visible) setFocused(true);
                            }}
                            onBlur={() => setFocused(false)}
                            aria-label={`${topic.label}?`}
                            aria-describedby="landing-shuffle-hint"
                            data-tooltip="Shuffle"
                        >
                            <RotatingWord topic={topic} reduced={reduced} />
                        </button>
                    </motion.h1>
                    <span id="landing-shuffle-hint" className="sr-only">
                        Shuffles to the next topic. The headline changes on its own every few seconds; keyboard focus pauses it.
                    </span>

                    <motion.p
                        className="landing__sub"
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.22 }}
                    >
                        Whatever it is, it deserves readers. Kalamio is the publishing
                        platform for every voice on earth — write your ideas, publish
                        your story, reach the people who care.
                    </motion.p>

                    <motion.div
                        className="landing__ctas"
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                    >
                        <Link to={access_token ? "/editor" : "/signup"} className="landing__btn-solid landing__btn-solid--lg">
                            <Icon name="edit_note" />
                            Start writing
                        </Link>
                        <Link to="/" className="landing__btn-ghost">
                            Explore stories
                            <Icon name="call_made" />
                        </Link>
                    </motion.div>

                    <motion.p
                        className="landing__hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.45 }}
                    >
                        Free to read · Free to write · Yours to keep
                    </motion.p>
                </div>
            </main>

            <footer className="landing__footer" aria-hidden="true">
                <div className="landing__marquee">
                    <div className="landing__marquee-track">
                        {/* 4 copies: one half (2 sets) must be wider than any real
                            viewport for the translateX(-50%) wrap to stay seamless —
                            item sizes cap out, so 2 sets ≈ 3300px covers up to ~3300px
                            screens. 2 copies gapped visibly on >1650px displays. */}
                        {[...TOPICS, ...TOPICS, ...TOPICS, ...TOPICS].map((t, i) => (
                            <span
                                key={i}
                                className="landing__marquee-item"
                                onClick={() => setIndex(i % TOPICS.length)}
                            >
                                {t.label}
                                <span className="landing__marquee-star">✦</span>
                            </span>
                        ))}
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
