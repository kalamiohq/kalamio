import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const TICK_COUNT = 15;
// The progress ticks need room to move. On a shorter article, a small scroll would jump the dark
// tick from one end of the column to the other.
const MIN_SCREENS_FOR_PROGRESS_TICKS = 1.5;
// The article body also has to be long in its own right. Browser zoom shrinks the screen, not the
// article, so the rule above alone brings the ticks back on a one-line post at high zoom.
const MIN_BODY_HEIGHT_FOR_PROGRESS_TICKS = 800;
// Height of the sticky navbar, so a heading scrolled into view isn't hidden under it.
const HEADER_OFFSET = 80;
// scrollIntoView can stop a fraction of a pixel short of the offset, so a heading that close still
// counts as reached.
const ACTIVE_SECTION_SLACK = 1;
// How long scrolling has to stop before a smooth scroll to a clicked section counts as finished.
const SCROLL_SETTLE_MS = 150;

const sectionTickClass = (isActive) =>
    `h-[2px] flex-none rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none ${
        isActive
            ? "w-[26px] bg-black"
            : "w-[16px] bg-border group-hover/row:w-[20px] group-hover/row:bg-dark-grey"
    }`;

// Vertical reading-progress indicator: a column of short ticks near the right edge, with the tick
// for the reader's current position drawn dark. It measures the target article container, not the
// whole document, so comments/footer below the article don't count toward progress. Updates go
// through the DOM (not React state) to keep scroll handling cheap.
//
// Sizes in the sections UI are in px, not Tailwind's rem scale: the app's root font size is 14px.
//
// When the article body has two or more headings, the column switches to one tick per section and
// the active tick follows the heading the reader is in. Hovering the column (or tabbing into it)
// opens a panel with each section's title. On narrow screens those same sections are offered
// through a fixed "Contents" button that opens a sheet.
const ReadingProgress = ({ targetRef, contentRef, resetKey, content }) => {
    const indicatorRef = useRef(null);
    const tickRefs = useRef([]);
    const contentsButtonRef = useRef(null);
    const closeButtonRef = useRef(null);
    const sheetRef = useRef(null);
    const holdSectionRef = useRef(false);
    const settleTimerRef = useRef(0);
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
            .map((el) => ({ el, text: (el.textContent || "").trim(), isSub: el.tagName === "H3" }))
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
        const body = contentRef?.current || target;
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

            // With sections, the ticks are navigation, so they only hide when the whole article fits
            // on screen and there's nothing to jump to.
            const tooShort = hasSections
                ? scrollable <= 0
                : rect.height < viewportHeight * MIN_SCREENS_FOR_PROGRESS_TICKS ||
                  body.getBoundingClientRect().height < MIN_BODY_HEIGHT_FOR_PROGRESS_TICKS;
            if (tooShort) {
                indicator.style.display = "none";
                return;
            }

            indicator.style.display = "";

            if (hasSections) {
                // While smooth-scrolling to a clicked section, stay on it instead of flicking
                // through every section passed on the way.
                if (holdSectionRef.current) return;

                // The active section is the last heading whose top has reached the navbar offset.
                let active = 0;
                sections.forEach((section, index) => {
                    if (section.el.getBoundingClientRect().top - HEADER_OFFSET <= ACTIVE_SECTION_SLACK) {
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

        const onScroll = () => {
            if (holdSectionRef.current) {
                clearTimeout(settleTimerRef.current);
                settleTimerRef.current = setTimeout(() => {
                    holdSectionRef.current = false;
                    schedule();
                }, SCROLL_SETTLE_MS);
            }
            schedule();
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", schedule);

        let observer;
        if (typeof ResizeObserver === "function") {
            observer = new ResizeObserver(schedule);
            observer.observe(target);
        }

        return () => {
            window.removeEventListener("scroll", onScroll);
            clearTimeout(settleTimerRef.current);
            window.removeEventListener("resize", schedule);
            if (observer) observer.disconnect();
            if (frame && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(frame);
            }
        };
    }, [targetRef, contentRef, resetKey, hasSections, sections]);

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

        holdSectionRef.current = true;
        section.el.scrollIntoView?.({ behavior: "smooth", block: "start" });
        setActiveIndex(index);
    };

    const selectSection = (index) => {
        scrollToSection(index);
        setSheetOpen(false);
    };

    return (
        <>
            {hasSections ? (
                <nav
                    ref={indicatorRef}
                    aria-label="Article sections"
                    className="group/toc fixed top-1/2 right-[32px] z-50 hidden -translate-y-1/2 lg:block"
                >
                    <div
                        aria-hidden="true"
                        className="flex flex-col items-end gap-[12px] py-[8px] pl-[12px] transition-opacity duration-100 ease-out motion-reduce:transition-none group-hover/toc:opacity-0 group-has-[:focus-visible]/toc:opacity-0"
                    >
                        {sections.map((section, index) => (
                            <span
                                key={`${section.text}-${index}`}
                                className={sectionTickClass(index === activeIndex)}
                            />
                        ))}
                    </div>
                    {/* -right-[15px] keeps the panel's ticks exactly over the resting ticks. */}
                    <div className="pointer-events-none absolute -right-[15px] top-1/2 flex max-h-[80vh] w-[300px] -translate-y-1/2 translate-x-[8px] flex-col gap-[2px] overflow-y-auto rounded-[16px] border border-border bg-white p-[10px] opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.10)] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none group-hover/toc:pointer-events-auto group-hover/toc:translate-x-0 group-hover/toc:opacity-100 group-has-[:focus-visible]/toc:pointer-events-auto group-has-[:focus-visible]/toc:translate-x-0 group-has-[:focus-visible]/toc:opacity-100">
                        {sections.map((section, index) => {
                            const isActive = index === activeIndex;
                            return (
                                <button
                                    key={`${section.text}-${index}`}
                                    type="button"
                                    aria-current={isActive ? "location" : undefined}
                                    data-active={String(isActive)}
                                    onClick={() => scrollToSection(index)}
                                    className={`group/row flex w-full items-center justify-between gap-[14px] rounded-[10px] py-[8px] pr-[4px] text-left font-inter text-[14px] leading-[1.35] transition-colors duration-200 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/50 ${
                                        section.isSub ? "pl-[24px]" : "pl-[10px]"
                                    } ${
                                        isActive
                                            ? "bg-grey font-semibold text-black"
                                            : "text-dark-grey hover:bg-grey/40 hover:text-black"
                                    }`}
                                >
                                    {/* The invisible bold copy reserves the width, so a row doesn't
                                        re-wrap and shift the panel when it becomes current. */}
                                    <span className="grid">
                                        <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
                                            {section.text}
                                        </span>
                                        <span className="col-start-1 row-start-1">{section.text}</span>
                                    </span>
                                    <span aria-hidden="true" className={sectionTickClass(isActive)} />
                                </button>
                            );
                        })}
                    </div>
                </nav>
            ) : (
                <div
                    ref={indicatorRef}
                    role="progressbar"
                    aria-label="Reading progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={0}
                    className="fixed top-1/2 right-8 z-50 hidden -translate-y-1/2 flex-col items-end gap-[7px] pointer-events-none lg:flex"
                >
                    {Array.from({ length: TICK_COUNT }, (_, index) => (
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
            )}

            {/* Sits above the bottom tab bar, which is also only shown below lg. */}
            {hasSections && (
                <button
                    ref={contentsButtonRef}
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-[16px] z-50 flex items-center gap-[8px] rounded-full border border-border bg-white px-[16px] py-[10px] font-inter text-[14px] font-semibold text-black shadow-[0_6px_20px_rgba(0,0,0,0.12)] transition-colors hover:bg-grey active:scale-95 lg:hidden"
                >
                    <Icon name="format_list_bulleted" className="text-[16px]" />
                    Contents
                </button>
            )}

            {sheetOpen && (
                <div className="fixed inset-0 z-[60] font-inter lg:hidden">
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
                        onClick={() => setSheetOpen(false)}
                    />
                    <div
                        ref={sheetRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="article-contents-title"
                        className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-[20px] bg-white px-[20px] pb-[calc(28px+env(safe-area-inset-bottom))] pt-[8px]"
                    >
                        <div aria-hidden="true" className="mx-auto mb-[14px] mt-[6px] h-[4px] w-[40px] rounded-full bg-border" />
                        <div className="mb-[6px] flex items-center justify-between">
                            <h2
                                id="article-contents-title"
                                className="text-[18px] font-bold text-black"
                            >
                                Contents
                            </h2>
                            <button
                                ref={closeButtonRef}
                                type="button"
                                onClick={() => setSheetOpen(false)}
                                aria-label="Close contents"
                                className="grid h-[36px] w-[36px] place-items-center rounded-full bg-grey text-black"
                            >
                                <Icon name="close" className="text-[18px]" />
                            </button>
                        </div>
                        <nav aria-label="Article contents">
                            {sections.map((section, index) => {
                                const isActive = index === activeIndex;
                                return (
                                    <button
                                        key={`${section.text}-${index}`}
                                        type="button"
                                        aria-current={isActive ? "location" : undefined}
                                        onClick={() => selectSection(index)}
                                        className={`flex w-full items-center gap-[12px] border-b border-grey py-[13px] text-left text-[16px] leading-[1.35] last:border-b-0 ${
                                            section.isSub ? "pl-[16px]" : ""
                                        } ${isActive ? "font-semibold text-black" : "text-dark-grey"}`}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`h-[20px] w-[3px] flex-none rounded-[3px] ${isActive ? "bg-black" : ""}`}
                                        />
                                        {section.text}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            )}
        </>
    );
};

export default ReadingProgress;
