import { useEffect, useRef } from "react";

// Thin horizontal reading-progress indicator. It measures the target article container, not the
// whole document, so comments/footer below the article don't count toward progress. The fill is
// updated through the DOM (not React state) to keep scroll handling cheap.
const ReadingProgress = ({ targetRef, resetKey }) => {
    const barRef = useRef(null);
    const fillRef = useRef(null);

    useEffect(() => {
        const target = targetRef.current;
        const bar = barRef.current;
        const fill = fillRef.current;
        if (!target || !bar || !fill) return;

        let frame = 0;

        const update = () => {
            frame = 0;
            const rect = target.getBoundingClientRect();
            const viewportHeight =
                window.innerHeight || document.documentElement.clientHeight || 0;
            const scrollable = rect.height - viewportHeight;

            let progress;
            if (scrollable > 0) {
                // Article top at the viewport top = 0%; article bottom at the viewport bottom = 100%.
                progress = (-rect.top / scrollable) * 100;
            } else {
                // A short article fits entirely on screen: it's fully readable at once.
                progress =
                    rect.top < viewportHeight && rect.bottom > 0 ? 100 : 0;
            }

            progress = Math.min(100, Math.max(0, progress));

            fill.style.transform = `scaleX(${progress / 100})`;
            bar.setAttribute("aria-valuenow", String(Math.round(progress)));
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
            ref={barRef}
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-border pointer-events-none"
        >
            <div
                ref={fillRef}
                className="h-full w-full origin-left bg-kalamio transition-transform duration-100 ease-out will-change-transform"
                style={{ transform: "scaleX(0)" }}
            />
        </div>
    );
};

export default ReadingProgress;
