import { useEffect, useRef } from "react";

const TICK_COUNT = 15;

// Vertical reading-progress indicator: a column of short ticks near the right edge, with the tick
// for the reader's current position drawn dark. It measures the target article container, not the
// whole document, so comments/footer below the article don't count toward progress. Updates go
// through the DOM (not React state) to keep scroll handling cheap.
const ReadingProgress = ({ targetRef, resetKey }) => {
    const indicatorRef = useRef(null);
    const tickRefs = useRef([]);

    useEffect(() => {
        const target = targetRef.current;
        const indicator = indicatorRef.current;
        const ticks = tickRefs.current.filter(Boolean);
        if (!target || !indicator || ticks.length === 0) return;

        let frame = 0;

        const update = () => {
            frame = 0;
            const rect = target.getBoundingClientRect();
            const viewportHeight =
                window.innerHeight || document.documentElement.clientHeight || 0;
            const scrollable = rect.height - viewportHeight;

            // The whole article fits on screen, so there is no position to track.
            if (scrollable <= 0) {
                indicator.hidden = true;
                return;
            }

            // Article top at the viewport top = 0%; article bottom at the viewport bottom = 100%.
            const progress = Math.min(
                100,
                Math.max(0, (-rect.top / scrollable) * 100)
            );

            indicator.hidden = false;
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
    }, [targetRef, resetKey]);

    return (
        <div
            ref={indicatorRef}
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            className="fixed top-1/2 right-2 z-50 flex -translate-y-1/2 flex-col items-end gap-[7px] pointer-events-none sm:right-8"
            hidden
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
    );
};

export default ReadingProgress;
