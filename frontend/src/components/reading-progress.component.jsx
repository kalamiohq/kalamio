import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const TICK_COUNT = 15;
// Height of the sticky navbar, so a heading scrolled into view isn't hidden under it.
const HEADER_OFFSET = 80;

// Vertical reading-progress indicator: a column of short ticks near the right edge, with the tick
// for the reader's current position drawn dark. It measures the target article container, not the
// whole document, so comments/footer below the article don't count toward progress. Updates go
// through the DOM (not React state) to keep scroll handling cheap.
//
// When the article body has two or more headings, the column switches to one tick per section and
// the active tick follows the heading the reader is in. On narrow screens those same sections are
// offered through a fixed "Contents" button that opens a sheet.
const ReadingProgress = ({ targetRef, contentRef, resetKey, content }) => {
    const indicatorRef = useRef(null);
    const tickRefs = useRef([]);
    const contentsButtonRef = useRef(null);
    const closeButtonRef = useRef(null);
    const sheetRef = useRef(null);
    const [sections, setSections] = useState([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [sheetOpen, setSheetOpen] = useState(false);

    const hasSections = sections.length >= 2;

    // Collect the headings rendered inside the article body. Refs to the elements are kept so we can
    // scroll to them without writing ids into the saved article content.
    useEffect(() => {
        const container = contentRef?.current || targetRef?.current;
        if (!container) {
            setSections([]);
            return;
        }

        const next = Array.from(container.querySelectorAll("h1, h2, h3"))
            .map((el) => ({ el, text: (el.textContent || "").trim() }))
            .filter((section) => section.text);

        // scrollIntoView respects scroll-margin, so the heading stops below the sticky navbar.
        next.forEach(({ el }) => {
            el.style.scrollMarginTop = `${HEADER_OFFSET}px`;
        });

        setSections(next);
        setActiveIndex(0);
        setSheetOpen(false);
    }, [contentRef, targetRef, resetKey, content]);

    useEffect(() => {
        const target = targetRef.current;
        const indicator = indicatorRef.current;
        if (!target || !indicator) return;

        const tickCount = hasSections ? sections.length : TICK_COUNT;
        const ticks = tickRefs.current.slice(0, tickCount).filter(Boolean);
        if (!hasSections && ticks.length === 0) return;

        let frame = 0;

        const update = () => {
            frame = 0;
            const rect = target.getBoundingClientRect();
            const viewportHeight =
                window.innerHeight || document.documentElement.clientHeight || 0;
            const scrollable = rect.height - viewportHeight;

            // The whole article fits on screen, so there is no position to track.
            if (scrollable <= 0) {
                indicator.style.display = "none";
                return;
            }

            indicator.style.display = "";

            if (hasSections) {
                // The active section is the last heading whose top has reached the navbar offset.
                let active = 0;
                sections.forEach((section, index) => {
                    if (section.el.getBoundingClientRect().top - HEADER_OFFSET <= 0) {
                        active = index;
                    }
                });
                setActiveIndex((previous) => (previous === active ? previous : active));
                return;
            }

            // Article top at the viewport top = 0%; article bottom at the viewport bottom = 100%.
            const progress = Math.min(
                100,
                Math.max(0, (-rect.top / scrollable) * 100)
            );

            indicator.setAttribute("aria-valuenow", String(Math.round(progress)));

            const active = Math.round((progress / 100) * (ticks.length - 1));
            ticks.forEach((tick, index) => {
                const isActive = index === active;
                tick.classList.toggle("bg-black", isActive);
                tick.classList.toggle("bg-border", !isActive);
                tick.setAttribute("data-active", String(isActive));
            });
        };

        const schedule = () => {
            if (frame) return;
            if (typeof requestAnimationFrame === "function") {
                frame = requestAnimationFrame(update);
            } else {
                update();
            }
        };

        // Initial measurement + track changes in the article's rendered height (images, embeds,
        // asynchronously rendered sections) and viewport resizes.
        update();

        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);

        let observer;
        if (typeof ResizeObserver === "function") {
            observer = new ResizeObserver(schedule);
            observer.observe(target);
        }

        return () => {
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            if (observer) observer.disconnect();
            if (frame && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(frame);
            }
        };
    }, [targetRef, resetKey, hasSections, sections]);

    // Close the Contents sheet with Esc, move focus into it when it opens, keep Tab inside it, and
    // restore focus to the trigger when it closes.
    useEffect(() => {
        if (!sheetOpen) return;

        const sheet = sheetRef.current;

        const handleKey = (event) => {
            if (event.key === "Escape") {
                setSheetOpen(false);
                return;
            }
            if (event.key !== "Tab" || !sheet) return;

            const focusable = Array.from(
                sheet.querySelectorAll(
                    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener("keydown", handleKey);
        closeButtonRef.current?.focus();
        return () => {
            window.removeEventListener("keydown", handleKey);
            contentsButtonRef.current?.focus();
        };
    }, [sheetOpen]);

    const scrollToSection = (index) => {
        const section = sections[index];
        if (!section) return;

        section.el.scrollIntoView?.({ behavior: "smooth", block: "start" });
        setActiveIndex(index);
    };

    const selectSection = (index) => {
        scrollToSection(index);
        setSheetOpen(false);
    };

    return (
        <>
            <div
                ref={indicatorRef}
                {...(hasSections
                    ? { role: "navigation", "aria-label": "Article sections" }
                    : {
                        role: "progressbar",
                        "aria-label": "Reading progress",
                        "aria-valuemin": 0,
                        "aria-valuemax": 100,
                        "aria-valuenow": 0,
                    })}
                className="fixed top-1/2 right-8 z-50 hidden -translate-y-1/2 flex-col items-end gap-[7px] pointer-events-none lg:flex"
            >
                {hasSections
                    ? sections.map((section, index) => {
                        const isActive = index === activeIndex;
                        return (
                            <button
                                key={`${section.text}-${index}`}
                                type="button"
                                aria-label={section.text}
                                aria-current={isActive ? "location" : undefined}
                                data-active={String(isActive)}
                                onClick={() => scrollToSection(index)}
                                className="group/tick pointer-events-auto relative flex items-center justify-end rounded-full py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
                            >
                                <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute right-full top-1/2 mr-2 max-w-[240px] -translate-y-1/2 truncate whitespace-nowrap rounded-md bg-black px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/tick:opacity-100 group-focus-visible/tick:opacity-100"
                                >
                                    {section.text}
                                </span>
                                <span
                                    aria-hidden="true"
                                    className={`h-[2px] rounded-full transition-all duration-150 ${
                                        isActive ? "w-6 bg-black" : "w-4 bg-border"
                                    }`}
                                />
                            </button>
                        );
                    })
                    : Array.from({ length: TICK_COUNT }, (_, index) => (
                        <span
                            key={index}
                            ref={(node) => {
                                tickRefs.current[index] = node;
                            }}
                            aria-hidden="true"
                            data-active={index === 0 ? "true" : "false"}
                            className={`h-[2px] w-4 rounded-full transition-colors duration-150 ${
                                index === 0 ? "bg-black" : "bg-border"
                            }`}
                        />
                    ))}
            </div>

            {hasSections && (
                <button
                    ref={contentsButtonRef}
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg transition-all hover:bg-grey active:scale-95 lg:hidden"
                >
                    <Icon name="list" className="text-lg" />
                    Contents
                </button>
            )}

            {sheetOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden">
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
                        onClick={() => setSheetOpen(false)}
                    />
                    <div
                        ref={sheetRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="article-contents-title"
                        className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-border bg-white p-4 shadow-2xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-[340px] sm:rounded-2xl"
                    >
                        <div className="mb-2 flex items-center justify-between">
                            <h2
                                id="article-contents-title"
                                className="text-base font-semibold text-black"
                            >
                                Contents
                            </h2>
                            <button
                                ref={closeButtonRef}
                                type="button"
                                onClick={() => setSheetOpen(false)}
                                aria-label="Close contents"
                                className="flex h-8 w-8 items-center justify-center rounded-full text-dark-grey transition-colors hover:bg-grey hover:text-black"
                            >
                                <Icon name="close" className="text-xl" />
                            </button>
                        </div>
                        <nav aria-label="Article contents" className="flex flex-col">
                            {sections.map((section, index) => (
                                <button
                                    key={`${section.text}-${index}`}
                                    type="button"
                                    onClick={() => selectSection(index)}
                                    className="w-full rounded-lg px-2 py-2 text-left text-sm text-black transition-colors hover:bg-grey"
                                >
                                    {section.text}
                                </button>
                            ))}
                        </nav>
                    </div>
                </div>
            )}
        </>
    );
};

export default ReadingProgress;
